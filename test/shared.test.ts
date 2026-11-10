import {describe, expect, it} from 'vitest'
import {buildUrl, parseQuery, syncParamsFromUrl} from '../src/shared/url'
import {Resolver, findVarNames, mergeVars} from '../src/shared/vars'
import {prepareRequest, toBase64} from '../src/shared/prepare'
import {
  emptyAuth,
  newCollection,
  newRequest,
  type Folder,
  type RequestDef
} from '../src/shared/model'
import {normalizeCollection, normalizeEnvironment, normalizeRequest} from '../src/shared/normalize'
import {
  cloneWithNewIds,
  findNode,
  listContainers,
  locationLabel,
  removeNode
} from '../src/shared/tree'
import {getPath, parsePath} from '../src/shared/jsonpath'
import {formatBytes, slugify} from '../src/shared/format'

const kv = (key: string, value: string, enabled = true) => ({key, value, enabled})

function request(patch: Partial<RequestDef> = {}): RequestDef {
  return {...newRequest('r1'), ...patch}
}

describe('url', () => {
  it('parses the query string without decoding it', () => {
    expect(parseQuery('https://x.io/a?q=hello%20world&flag&v={{id}}#top')).toEqual([
      kv('q', 'hello%20world'),
      kv('flag', ''),
      kv('v', '{{id}}')
    ])
  })

  it('rebuilds the url from enabled params and keeps the fragment', () => {
    expect(
      buildUrl('https://x.io/a?old=1#top', [kv('a', '1'), kv('b', '2', false), kv('c', '')])
    ).toBe('https://x.io/a?a=1&c#top')
  })

  it('drops the ? when no params are left', () => {
    expect(buildUrl('https://x.io/a?x=1', [])).toBe('https://x.io/a')
  })

  it('keeps disabled params when the url is edited', () => {
    expect(syncParamsFromUrl('https://x.io?a=2', [kv('a', '1'), kv('off', 'x', false)])).toEqual([
      kv('a', '2'),
      kv('off', 'x', false)
    ])
  })
})

describe('vars', () => {
  it('gives earlier layers priority and skips disabled rows', () => {
    const vars = mergeVars(
      [kv('a', 'env'), kv('b', 'off', false)],
      [kv('a', 'coll'), kv('b', 'coll')]
    )
    expect(vars).toEqual({a: 'env', b: 'coll'})
  })

  it('resolves nested variables and records unknown ones', () => {
    const r = new Resolver({base: 'https://{{host}}', host: 'api.dev'})
    expect(r.resolve('{{ base }}/users/{{id}}')).toBe('https://api.dev/users/{{id}}')
    expect([...r.unresolved]).toEqual(['id'])
  })

  it('stops on self-referencing variables', () => {
    const r = new Resolver({loop: '{{loop}}'})
    expect(r.resolve('{{loop}}')).toBe('{{loop}}')
  })

  it('fills dynamic variables', () => {
    const r = new Resolver({})
    expect(r.resolve('{{$guid}}')).toMatch(/^[0-9a-f-]{20,}$/)
    expect(Number(r.resolve('{{$timestamp}}'))).toBeGreaterThan(1_600_000_000)
    expect(r.unresolved.size).toBe(0)
  })

  it('lists variable names', () => {
    expect(findVarNames('{{a}} and {{ b }} {c}')).toEqual(['a', 'b'])
  })
})

describe('prepareRequest', () => {
  it('substitutes variables, adds a scheme and default headers', () => {
    const {prepared, unresolved} = prepareRequest({
      request: request({
        method: 'POST',
        url: '{{host}}/users',
        headers: [kv('X-Trace', '{{trace}}'), kv('X-Off', '1', false)],
        body: {type: 'json', raw: '{"name":"{{name}}"}', form: [], multipart: [], file: ''}
      }),
      vars: {host: 'localhost:3000', name: 'Ada'},
      userAgent: 'Restly/test'
    })
    expect(prepared.url).toBe('http://localhost:3000/users')
    expect(prepared.body).toEqual({kind: 'text', text: '{"name":"Ada"}'})
    expect(prepared.headers).toEqual([
      ['X-Trace', '{{trace}}'],
      ['Content-Type', 'application/json'],
      ['Accept', '*/*'],
      ['User-Agent', 'Restly/test']
    ])
    expect(unresolved).toEqual(['trace'])
  })

  it('never overrides a header the user set', () => {
    const {prepared} = prepareRequest({
      request: request({
        headers: [kv('content-type', 'application/vnd.api+json'), kv('accept', 'text/html')],
        body: {type: 'json', raw: '{}', form: [], multipart: [], file: ''}
      }),
      vars: {}
    })
    expect(prepared.headers).toEqual([
      ['content-type', 'application/vnd.api+json'],
      ['accept', 'text/html']
    ])
  })

  it('applies bearer, basic and api key auth', () => {
    const bearer = prepareRequest({
      request: request({url: 'https://x.io', auth: {...emptyAuth('bearer'), bearer: '{{t}}'}}),
      vars: {t: 'abc'}
    })
    expect(bearer.prepared.headers).toContainEqual(['Authorization', 'Bearer abc'])

    const basic = prepareRequest({
      request: request({
        url: 'https://x.io',
        auth: {...emptyAuth('basic'), username: 'ü', password: 'p'}
      }),
      vars: {}
    })
    expect(basic.prepared.headers).toContainEqual(['Authorization', `Basic ${toBase64('ü:p')}`])

    const query = prepareRequest({
      request: request({
        url: 'https://x.io/a?x=1#h',
        auth: {...emptyAuth('apikey'), apiKeyName: 'api key', apiKeyValue: 'v&1', apiKeyIn: 'query'}
      }),
      vars: {}
    })
    expect(query.prepared.url).toBe('https://x.io/a?x=1&api%20key=v%261#h')
  })

  it('inherits collection auth only when asked to', () => {
    const collectionAuth = {...emptyAuth('bearer'), bearer: 'col'}
    const inherit = prepareRequest({request: request({url: 'x.io'}), collectionAuth, vars: {}})
    expect(inherit.prepared.headers).toContainEqual(['Authorization', 'Bearer col'])
    const none = prepareRequest({
      request: request({url: 'x.io', auth: emptyAuth('none')}),
      collectionAuth,
      vars: {}
    })
    expect(none.prepared.headers.some(([k]) => k === 'Authorization')).toBe(false)
  })

  it('prepares form and multipart bodies from enabled rows', () => {
    const form = prepareRequest({
      request: request({
        body: {
          type: 'form',
          raw: '',
          form: [kv('a', '{{v}}'), kv('b', '2', false)],
          multipart: [],
          file: ''
        }
      }),
      vars: {v: '1'}
    })
    expect(form.prepared.body).toEqual({kind: 'form', fields: [['a', '1']]})

    const multipart = prepareRequest({
      request: request({
        body: {
          type: 'multipart',
          raw: '',
          form: [],
          multipart: [
            {key: 'name', value: 'x', kind: 'text', enabled: true},
            {key: 'doc', value: '/tmp/a.txt', kind: 'file', enabled: true}
          ],
          file: ''
        }
      }),
      vars: {}
    })
    expect(multipart.prepared.body).toEqual({
      kind: 'multipart',
      fields: [
        {key: 'name', value: 'x', file: false},
        {key: 'doc', value: '/tmp/a.txt', file: true}
      ]
    })
    expect(multipart.prepared.headers.some(([k]) => k === 'Content-Type')).toBe(false)
  })
})

describe('normalize', () => {
  it('fills defaults for partial requests', () => {
    const r = normalizeRequest({name: 'x', method: 'post', headers: [{key: 'a'}]})
    expect(r.method).toBe('POST')
    expect(r.headers).toEqual([kv('a', '')])
    expect(r.body.type).toBe('none')
    expect(r.auth.type).toBe('inherit')
  })

  it('rejects files that are not Restly data', () => {
    expect(normalizeCollection({info: {}, item: []})).toBeNull()
    expect(normalizeEnvironment({name: 'x'})).toBeNull()
  })

  it('reads nested folders', () => {
    const c = normalizeCollection({
      restly: 1,
      id: 'c',
      name: 'C',
      children: [
        {type: 'folder', id: 'f', name: 'F', children: [{type: 'request', id: 'r', name: 'R'}]},
        42
      ]
    })!
    expect(c.children).toHaveLength(1)
    expect((c.children[0] as Folder).children[0].id).toBe('r')
  })
})

describe('tree', () => {
  const build = () => {
    const c = newCollection('c', 'API')
    const inner: Folder = {type: 'folder', id: 'f2', name: 'Admin', children: [request({id: 'r2'})]}
    c.children = [request({id: 'r1'}), {type: 'folder', id: 'f1', name: 'Users', children: [inner]}]
    return c
  }

  it('finds and removes nested nodes', () => {
    const c = build()
    expect(findNode(c, 'r2')?.parent.id).toBe('f2')
    expect(removeNode(c, 'r2')?.id).toBe('r2')
    expect(findNode(c, 'r2')).toBeNull()
  })

  it('labels containers and locations', () => {
    const c = build()
    expect(listContainers(c).map((x) => x.label)).toEqual([
      'API',
      'API / Users',
      'API / Users / Admin'
    ])
    expect(locationLabel(c, 'r2')).toBe('API / Users / Admin')
    expect(locationLabel(c, 'r1')).toBe('API')
    expect(locationLabel(c, 'missing')).toBeNull()
  })

  it('gives clones fresh ids all the way down', () => {
    const c = build()
    const folder = findNode(c, 'f1')!.node as Folder
    const copy = cloneWithNewIds(folder)
    expect(copy.id).not.toBe('f1')
    expect((copy.children[0] as Folder).children[0].id).not.toBe('r2')
    expect(folder.children[0].id).toBe('f2')
  })
})

describe('jsonpath', () => {
  const data = {data: {items: [{id: 1, 'a b': true}, {id: 2}]}, n: null}

  it('parses the supported syntax', () => {
    expect(parsePath('$.data.items[0]["a b"]')).toEqual(['data', 'items', 0, 'a b'])
    expect(parsePath('data.items.1.id')).toEqual(['data', 'items', 1, 'id'])
  })

  it('reads values, lengths and negative indexes', () => {
    expect(getPath(data, '$.data.items[1].id')).toEqual({found: true, value: 2})
    expect(getPath(data, '$.data.items.length')).toEqual({found: true, value: 2})
    expect(getPath(data, '$.data.items[-1].id')).toEqual({found: true, value: 2})
    expect(getPath(data, "$.data.items[0]['a b']")).toEqual({found: true, value: true})
    expect(getPath(data, '$.n')).toEqual({found: true, value: null})
    expect(getPath(data, '$.n.x').found).toBe(false)
    expect(getPath(data, '$.data.missing').found).toBe(false)
  })
})

describe('format', () => {
  it('formats bytes and slugs', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(slugify('My  API: v2!')).toBe('my-api-v2')
    expect(slugify('???')).toBe('untitled')
  })
})

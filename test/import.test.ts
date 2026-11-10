import {describe, expect, it} from 'vitest'
import {CurlParseError, isCurlCommand, parseCurl, tokenize} from '../src/shared/curl'
import {
  detectImport,
  fromPostmanCollection,
  fromPostmanEnvironment,
  importJson
} from '../src/shared/postman'
import {generateCode, shellQuote, toCurl} from '../src/shared/codegen'
import {prepareRequest, type PreparedRequest} from '../src/shared/prepare'
import type {Folder, RequestDef} from '../src/shared/model'

describe('tokenize', () => {
  it('handles quotes, escapes and continuations', () => {
    expect(tokenize(`curl 'a b' "c \\"d\\"" e\\ f \\\n  -H x`)).toEqual([
      'curl',
      'a b',
      'c "d"',
      'e f',
      '-H',
      'x'
    ])
  })

  it('handles ANSI-C quoting from Chrome', () => {
    expect(tokenize(`curl $'line\\nnext \\'q\\''`)).toEqual(['curl', "line\nnext 'q'"])
  })

  it('handles Windows cmd escapes', () => {
    expect(tokenize('curl ^"https://x.io/a?b=1^&c=2^" ^\n  -H ^"accept: */*^"')).toEqual([
      'curl',
      'https://x.io/a?b=1&c=2',
      '-H',
      'accept: */*'
    ])
  })

  it('treats a flattened backslash continuation as a separator', () => {
    expect(tokenize("curl 'https://x.io' \\   -H 'a: b'")).toEqual([
      'curl',
      'https://x.io',
      '-H',
      'a: b'
    ])
  })

  it('throws on unclosed quotes', () => {
    expect(() => tokenize("curl 'oops")).toThrow(CurlParseError)
  })
})

describe('parseCurl', () => {
  it('reads method, headers and a JSON body', () => {
    const r = parseCurl(
      `curl -X PUT 'https://api.x.io/users/7?expand=1' -H 'Content-Type: application/json' -H 'X-A: 1' --data-raw '{"name":"Ada"}'`
    )
    expect(r.method).toBe('PUT')
    expect(r.url).toBe('https://api.x.io/users/7?expand=1')
    expect(r.params).toEqual([{key: 'expand', value: '1', enabled: true}])
    expect(r.headers.map((h) => h.key)).toEqual(['Content-Type', 'X-A'])
    expect(r.body.type).toBe('json')
    expect(JSON.parse(r.body.raw)).toEqual({name: 'Ada'})
    expect(r.name).toBe('PUT 7')
  })

  it('defaults to POST with a body and to form encoding for k=v data', () => {
    const r = parseCurl(`curl https://x.io/login -d 'user=ada&pass=a%20b'`)
    expect(r.method).toBe('POST')
    expect(r.body.type).toBe('form')
    expect(r.body.form).toEqual([
      {key: 'user', value: 'ada', enabled: true},
      {key: 'pass', value: 'a b', enabled: true}
    ])
  })

  it('reads --json, -u, -F and combined short flags', () => {
    const json = parseCurl(`curl -sSL --json '{"a":1}' https://x.io`)
    expect(json.method).toBe('POST')
    expect(json.body.type).toBe('json')
    expect(json.headers).toContainEqual({
      key: 'Content-Type',
      value: 'application/json',
      enabled: true
    })

    const auth = parseCurl(`curl -u ada:secret:x https://x.io`)
    expect(auth.auth).toMatchObject({type: 'basic', username: 'ada', password: 'secret:x'})

    const form = parseCurl(
      `curl https://x.io/up -F 'name=doc' -F 'file=@/tmp/a b.pdf;type=application/pdf'`
    )
    expect(form.body.type).toBe('multipart')
    expect(form.body.multipart).toEqual([
      {key: 'name', value: 'doc', kind: 'text', enabled: true},
      {key: 'file', value: '/tmp/a b.pdf', kind: 'file', enabled: true}
    ])
  })

  it('moves data into the query with -G and supports -XPOST and -I', () => {
    const get = parseCurl(`curl -G https://x.io/s -d q=1 --data-urlencode 'name=a b'`)
    expect(get.method).toBe('GET')
    expect(get.url).toBe('https://x.io/s?q=1&name=a%20b')
    expect(get.body.type).toBe('none')

    expect(parseCurl('curl -XPOST https://x.io').method).toBe('POST')
    expect(parseCurl('curl -I https://x.io').method).toBe('HEAD')
  })

  it('rejects text that is not curl', () => {
    expect(isCurlCommand('curl https://x')).toBe(true)
    expect(isCurlCommand('wget https://x')).toBe(false)
    expect(() => parseCurl('wget https://x')).toThrow(CurlParseError)
    expect(() => parseCurl('curl -H "a: b"')).toThrow('No URL')
  })
})

describe('codegen', () => {
  const prepared: PreparedRequest = {
    method: 'POST',
    url: "https://x.io/a?b=it's",
    headers: [['Content-Type', 'application/json']],
    body: {kind: 'text', text: `{"msg":"it's"}`}
  }

  it('quotes for the shell', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })

  it('produces curl that parses back to the same request', () => {
    const back = parseCurl(toCurl(prepared))
    expect(back.method).toBe('POST')
    expect(back.url).toBe(prepared.url)
    expect(back.body.raw).toBe(JSON.stringify({msg: "it's"}, null, 2))
  })

  it('round-trips form and multipart bodies through curl', () => {
    const form = parseCurl(
      toCurl({
        ...prepared,
        headers: [],
        body: {
          kind: 'form',
          fields: [
            ['a', 'x y'],
            ['b', '&']
          ]
        }
      })
    )
    expect(form.body.form).toEqual([
      {key: 'a', value: 'x y', enabled: true},
      {key: 'b', value: '&', enabled: true}
    ])
    const multipart = parseCurl(
      toCurl({
        ...prepared,
        body: {kind: 'multipart', fields: [{key: 'f', value: '/a.png', file: true}]}
      })
    )
    expect(multipart.body.multipart[0]).toMatchObject({key: 'f', value: '/a.png', kind: 'file'})
  })

  it('generates fetch, axios and python snippets', () => {
    expect(generateCode('fetch', prepared)).toContain(`await fetch("https://x.io/a?b=it's", {`)
    expect(generateCode('axios', prepared)).toContain(`method: "post"`)
    const py = generateCode('python', prepared)
    expect(py).toContain(
      'requests.request("POST", url, headers=headers, data=data.encode("utf-8"))'
    )
    expect(generateCode('curl', {...prepared, method: 'GET', body: {kind: 'none'}})).toMatch(
      /^curl '/
    )
  })

  it('reads files in generated JS for file bodies', () => {
    const code = generateCode('fetch', {...prepared, body: {kind: 'file', path: '/tmp/x.bin'}})
    expect(code).toContain("import fs from 'node:fs'")
    expect(code).toContain('fs.readFileSync("/tmp/x.bin")')
  })

  it('round-trips a prepared request from a parsed curl command', () => {
    const parsed = parseCurl(`curl https://x.io -H 'X-Id: 1'`)
    const {prepared: again} = prepareRequest({request: parsed, vars: {}})
    expect(toCurl(again)).toContain(`-H 'X-Id: 1'`)
  })
})

const postman = {
  info: {
    name: 'Shop',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  auth: {type: 'bearer', bearer: [{key: 'token', value: '{{token}}', type: 'string'}]},
  variable: [{key: 'base', value: 'https://shop.io'}],
  item: [
    {
      name: 'Products',
      item: [
        {
          name: 'List',
          request: {
            method: 'GET',
            header: [
              {key: 'Accept', value: 'application/json'},
              {key: 'X-Off', value: '1', disabled: true}
            ],
            url: {raw: '{{base}}/products?page=1', host: ['{{base}}'], path: ['products']}
          }
        },
        {
          name: 'Create',
          request: {
            method: 'POST',
            url: '{{base}}/products',
            body: {mode: 'raw', raw: '{"name":"x"}', options: {raw: {language: 'json'}}},
            auth: {type: 'noauth'}
          }
        }
      ]
    },
    {
      name: 'Upload',
      request: {
        method: 'POST',
        url: '{{base}}/upload',
        body: {
          mode: 'formdata',
          formdata: [
            {key: 'title', value: 'a', type: 'text'},
            {key: 'file', src: '/tmp/x.png', type: 'file'}
          ]
        },
        auth: {
          type: 'basic',
          basic: [
            {key: 'username', value: 'u'},
            {key: 'password', value: 'p'}
          ]
        }
      }
    },
    {
      name: 'Query',
      request: {
        method: 'POST',
        url: '{{base}}/graphql',
        body: {mode: 'graphql', graphql: {query: '{ me { id } }', variables: '{"a":1}'}}
      }
    }
  ]
}

describe('postman import', () => {
  it('detects formats', () => {
    expect(detectImport(postman)).toBe('postman-collection')
    expect(detectImport({name: 'Dev', values: []})).toBe('postman-environment')
    expect(detectImport({restly: 1, children: []})).toBe('restly-collection')
    expect(detectImport({foo: 1})).toBeNull()
  })

  it('converts folders, requests, auth and bodies', () => {
    const c = fromPostmanCollection(postman)
    expect(c.name).toBe('Shop')
    expect(c.variables).toEqual([{key: 'base', value: 'https://shop.io', enabled: true}])
    expect(c.auth).toMatchObject({type: 'bearer', bearer: '{{token}}'})

    const folder = c.children[0] as Folder
    expect(folder.type).toBe('folder')
    const [list, create] = folder.children as RequestDef[]
    expect(list.url).toBe('{{base}}/products?page=1')
    expect(list.params).toEqual([{key: 'page', value: '1', enabled: true}])
    expect(list.headers[1]).toEqual({key: 'X-Off', value: '1', enabled: false})
    expect(list.auth.type).toBe('inherit')
    expect(create.body).toMatchObject({type: 'json', raw: '{"name":"x"}'})
    expect(create.auth.type).toBe('none')

    const upload = c.children[1] as RequestDef
    expect(upload.body.multipart).toEqual([
      {key: 'title', value: 'a', kind: 'text', enabled: true},
      {key: 'file', value: '/tmp/x.png', kind: 'file', enabled: true}
    ])
    expect(upload.auth).toMatchObject({type: 'basic', username: 'u', password: 'p'})

    const query = c.children[2] as RequestDef
    expect(JSON.parse(query.body.raw)).toEqual({query: '{ me { id } }', variables: {a: 1}})
  })

  it('converts environments with secrets', () => {
    const env = fromPostmanEnvironment({
      name: 'Prod',
      values: [
        {key: 'host', value: 'p.io', enabled: true},
        {key: 'token', value: 's3', enabled: true, type: 'secret'},
        {key: 'old', value: '1', enabled: false}
      ]
    })
    expect(env.variables).toEqual([
      {key: 'host', value: 'p.io', enabled: true, secret: false},
      {key: 'token', value: 's3', enabled: true, secret: true},
      {key: 'old', value: '1', enabled: false, secret: false}
    ])
  })

  it('gives re-imported Restly collections a new id', () => {
    const result = importJson({restly: 1, id: 'same', name: 'X', children: []})
    expect(result.kind).toBe('collection')
    if (result.kind === 'collection') expect(result.collection.id).not.toBe('same')
    expect(() => importJson({nope: true})).toThrow('Unrecognised file')
  })
})

import {
  HTTP_METHODS,
  emptyAuth,
  emptyBody,
  newCollection,
  type Auth,
  type Collection,
  type CollectionNode,
  type EnvVariable,
  type Environment,
  type HttpMethod,
  type KeyValue,
  type RequestDef
} from './model'
import {newId} from './id'
import {parseQuery} from './url'
import {normalizeCollection, normalizeEnvironment} from './normalize'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])

export type ImportKind =
  'restly-collection' | 'restly-environment' | 'postman-collection' | 'postman-environment'

export function detectImport(json: unknown): ImportKind | null {
  if (!isObj(json)) return null
  if (json.restly === 1 && Array.isArray(json.children)) return 'restly-collection'
  if (json.restly === 1 && Array.isArray(json.variables)) return 'restly-environment'
  if (isObj(json.info) && Array.isArray(json.item)) return 'postman-collection'
  if (Array.isArray(json.values) && typeof json.name === 'string') return 'postman-environment'
  return null
}

function keyValues(list: unknown): KeyValue[] {
  return arr(list)
    .filter((kv) => str(kv.key))
    .map((kv) => ({key: str(kv.key), value: str(kv.value), enabled: kv.disabled !== true}))
}

/** Postman 2.1 stores auth params as `[{key, value}]`; 2.0 as a plain object. */
function authParam(auth: Obj, type: string, key: string): string {
  const params = auth[type]
  if (Array.isArray(params)) return str(arr(params).find((p) => p.key === key)?.value)
  if (isObj(params)) return str(params[key])
  return ''
}

function convertAuth(v: unknown, fallback: Auth['type']): Auth {
  if (!isObj(v)) return emptyAuth(fallback)
  const type = str(v.type)
  const auth = emptyAuth(fallback)
  switch (type) {
    case 'noauth':
      auth.type = 'none'
      break
    case 'bearer':
      auth.type = 'bearer'
      auth.bearer = authParam(v, 'bearer', 'token')
      break
    case 'basic':
      auth.type = 'basic'
      auth.username = authParam(v, 'basic', 'username')
      auth.password = authParam(v, 'basic', 'password')
      break
    case 'apikey':
      auth.type = 'apikey'
      auth.apiKeyName = authParam(v, 'apikey', 'key')
      auth.apiKeyValue = authParam(v, 'apikey', 'value')
      auth.apiKeyIn = authParam(v, 'apikey', 'in') === 'query' ? 'query' : 'header'
      break
  }
  return auth
}

function convertUrl(v: unknown): string {
  if (typeof v === 'string') return v
  if (!isObj(v)) return ''
  if (typeof v.raw === 'string') return v.raw
  const host = Array.isArray(v.host) ? v.host.map(str).join('.') : str(v.host)
  const path = Array.isArray(v.path) ? v.path.map(str).join('/') : str(v.path)
  const protocol = str(v.protocol)
  const query = keyValues(v.query)
    .map((q) => `${q.key}=${q.value}`)
    .join('&')
  return `${protocol ? `${protocol}://` : ''}${host}${path ? `/${path}` : ''}${query ? `?${query}` : ''}`
}

function convertBody(v: unknown): RequestDef['body'] {
  const body = emptyBody()
  if (!isObj(v)) return body
  switch (str(v.mode)) {
    case 'raw': {
      const options = isObj(v.options) && isObj(v.options.raw) ? v.options.raw : {}
      const language = str(options.language)
      body.raw = str(v.raw)
      body.type = language === 'json' ? 'json' : language === 'xml' ? 'xml' : 'text'
      if (body.type === 'text' && /^\s*[{[]/.test(body.raw)) {
        try {
          JSON.parse(body.raw)
          body.type = 'json'
        } catch {
          // not JSON; stays text
        }
      }
      break
    }
    case 'urlencoded':
      body.type = 'form'
      body.form = keyValues(v.urlencoded)
      break
    case 'formdata':
      body.type = 'multipart'
      body.multipart = arr(v.formdata)
        .filter((f) => str(f.key))
        .map((f) => {
          const file = f.type === 'file'
          const src = Array.isArray(f.src) ? str(f.src[0]) : str(f.src)
          return {
            key: str(f.key),
            value: file ? src : str(f.value),
            kind: file ? ('file' as const) : ('text' as const),
            enabled: f.disabled !== true
          }
        })
      break
    case 'file':
      body.type = 'binary'
      body.file = isObj(v.file) ? str(v.file.src) : ''
      break
    case 'graphql': {
      const gql = isObj(v.graphql) ? v.graphql : {}
      let variables: unknown = {}
      try {
        variables = gql.variables ? JSON.parse(str(gql.variables)) : {}
      } catch {
        variables = {}
      }
      body.type = 'json'
      body.raw = JSON.stringify({query: str(gql.query), variables}, null, 2)
      break
    }
  }
  return body
}

function convertRequest(item: Obj): RequestDef {
  const req = isObj(item.request) ? item.request : {url: str(item.request)}
  const method = str(req.method).toUpperCase() || 'GET'
  const url = convertUrl(req.url)
  return {
    type: 'request',
    id: newId(),
    name: str(item.name) || `${method} ${url}`,
    method: (HTTP_METHODS as readonly string[]).includes(method) ? (method as HttpMethod) : 'GET',
    url,
    params: parseQuery(url),
    headers: keyValues(req.header),
    body: convertBody(req.body),
    auth: convertAuth(req.auth, 'inherit'),
    tests: []
  }
}

function convertItems(items: unknown): CollectionNode[] {
  return arr(items).map((item): CollectionNode => {
    if (Array.isArray(item.item)) {
      return {
        type: 'folder',
        id: newId(),
        name: str(item.name) || 'Folder',
        children: convertItems(item.item)
      }
    }
    return convertRequest(item)
  })
}

export function fromPostmanCollection(json: unknown): Collection {
  if (!isObj(json) || !isObj(json.info) || !Array.isArray(json.item)) {
    throw new Error('Not a Postman collection (v2.0 / v2.1)')
  }
  const collection = newCollection(newId(), str(json.info.name) || 'Imported collection')
  collection.children = convertItems(json.item)
  collection.variables = keyValues(json.variable)
  collection.auth = convertAuth(json.auth, 'none')
  return collection
}

export function fromPostmanEnvironment(json: unknown): Environment {
  if (!isObj(json) || !Array.isArray(json.values)) throw new Error('Not a Postman environment')
  const variables: EnvVariable[] = arr(json.values)
    .filter((v) => str(v.key))
    .map((v) => ({
      key: str(v.key),
      value: str(v.value),
      enabled: v.enabled !== false,
      secret: v.type === 'secret'
    }))
  return {restly: 1, id: newId(), name: str(json.name) || 'Imported environment', variables}
}

export type ImportResult =
  {kind: 'collection'; collection: Collection} | {kind: 'environment'; environment: Environment}

/** Turns any supported JSON export into Restly data with fresh ids. */
export function importJson(json: unknown): ImportResult {
  switch (detectImport(json)) {
    case 'postman-collection':
      return {kind: 'collection', collection: fromPostmanCollection(json)}
    case 'postman-environment':
      return {kind: 'environment', environment: fromPostmanEnvironment(json)}
    case 'restly-collection': {
      const collection = normalizeCollection(json)!
      collection.id = newId()
      return {kind: 'collection', collection}
    }
    case 'restly-environment': {
      const environment = normalizeEnvironment(json)!
      environment.id = newId()
      return {kind: 'environment', environment}
    }
    default:
      throw new Error(
        'Unrecognised file. Supported: Postman collection v2.x, Postman environment, Restly collection or environment.'
      )
  }
}

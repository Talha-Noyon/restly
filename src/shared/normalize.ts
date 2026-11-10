import {
  AUTH_TYPES,
  BODY_TYPES,
  HTTP_METHODS,
  TEST_OPS,
  TEST_TARGETS,
  emptyAuth,
  type Auth,
  type Collection,
  type CollectionNode,
  type EnvVariable,
  type Environment,
  type Folder,
  type HttpMethod,
  type KeyValue,
  type MultipartField,
  type RequestBody,
  type RequestDef,
  type TestRow
} from './model'
import {newId} from './id'

/*
 * Files on disk and imported JSON are untrusted: every reader goes through these
 * functions, which fill in defaults so the rest of the code can rely on the types.
 */

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback

export function normalizeKeyValues(v: unknown): KeyValue[] {
  return arr(v)
    .filter(isObj)
    .map((kv) => ({key: str(kv.key), value: str(kv.value), enabled: bool(kv.enabled, true)}))
}

function normalizeMultipart(v: unknown): MultipartField[] {
  return arr(v)
    .filter(isObj)
    .map((f) => ({
      key: str(f.key),
      value: str(f.value),
      kind: f.kind === 'file' ? 'file' : 'text',
      enabled: bool(f.enabled, true)
    }))
}

export function normalizeAuth(v: unknown, fallbackType: Auth['type'] = 'inherit'): Auth {
  if (!isObj(v)) return emptyAuth(fallbackType)
  return {
    type: oneOf(v.type, AUTH_TYPES, fallbackType),
    bearer: str(v.bearer),
    username: str(v.username),
    password: str(v.password),
    apiKeyName: str(v.apiKeyName),
    apiKeyValue: str(v.apiKeyValue),
    apiKeyIn: v.apiKeyIn === 'query' ? 'query' : 'header'
  }
}

function normalizeBody(v: unknown): RequestBody {
  const b = isObj(v) ? v : {}
  return {
    type: oneOf(b.type, BODY_TYPES, 'none'),
    raw: str(b.raw),
    form: normalizeKeyValues(b.form),
    multipart: normalizeMultipart(b.multipart),
    file: str(b.file)
  }
}

function normalizeTests(v: unknown): TestRow[] {
  return arr(v)
    .filter(isObj)
    .map((t) => ({
      target: oneOf(t.target, TEST_TARGETS, 'status'),
      path: str(t.path),
      op: oneOf(t.op, TEST_OPS, 'equals'),
      value: str(t.value),
      enabled: bool(t.enabled, true)
    }))
}

export function normalizeRequest(v: unknown): RequestDef {
  const r = isObj(v) ? v : {}
  const method = str(r.method, 'GET').toUpperCase()
  return {
    type: 'request',
    id: str(r.id) || newId(),
    name: str(r.name) || 'Untitled',
    method: (HTTP_METHODS as readonly string[]).includes(method) ? (method as HttpMethod) : 'GET',
    url: str(r.url),
    params: normalizeKeyValues(r.params),
    headers: normalizeKeyValues(r.headers),
    body: normalizeBody(r.body),
    auth: normalizeAuth(r.auth),
    tests: normalizeTests(r.tests)
  }
}

function normalizeNode(v: unknown): CollectionNode | null {
  if (!isObj(v)) return null
  if (v.type === 'folder') {
    const folder: Folder = {
      type: 'folder',
      id: str(v.id) || newId(),
      name: str(v.name) || 'Folder',
      children: normalizeNodes(v.children)
    }
    return folder
  }
  return normalizeRequest(v)
}

function normalizeNodes(v: unknown): CollectionNode[] {
  return arr(v)
    .map(normalizeNode)
    .filter((n): n is CollectionNode => n !== null)
}

/** Returns null when the value is not a Restly collection at all. */
export function normalizeCollection(v: unknown): Collection | null {
  if (!isObj(v) || v.restly !== 1 || !Array.isArray(v.children)) return null
  return {
    restly: 1,
    id: str(v.id) || newId(),
    name: str(v.name) || 'Collection',
    variables: normalizeKeyValues(v.variables),
    auth: normalizeAuth(v.auth, 'none'),
    children: normalizeNodes(v.children)
  }
}

/** Returns null when the value is not a Restly environment at all. */
export function normalizeEnvironment(v: unknown): Environment | null {
  if (!isObj(v) || v.restly !== 1 || !Array.isArray(v.variables)) return null
  const variables: EnvVariable[] = v.variables.filter(isObj).map((x) => ({
    key: str(x.key),
    value: str(x.value),
    enabled: bool(x.enabled, true),
    secret: bool(x.secret, false)
  }))
  return {restly: 1, id: str(v.id) || newId(), name: str(v.name) || 'Environment', variables}
}

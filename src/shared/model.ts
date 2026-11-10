export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export interface KeyValue {
  key: string
  value: string
  enabled: boolean
}

export const BODY_TYPES = ['none', 'json', 'text', 'xml', 'form', 'multipart', 'binary'] as const
export type BodyType = (typeof BODY_TYPES)[number]

export interface MultipartField {
  key: string
  value: string
  kind: 'text' | 'file'
  enabled: boolean
}

export interface RequestBody {
  type: BodyType
  /** Used by json, text and xml. */
  raw: string
  form: KeyValue[]
  multipart: MultipartField[]
  /** Path of the file sent by the binary body type. */
  file: string
}

export const AUTH_TYPES = ['inherit', 'none', 'bearer', 'basic', 'apikey'] as const
export type AuthType = (typeof AUTH_TYPES)[number]

export interface Auth {
  type: AuthType
  bearer: string
  username: string
  password: string
  apiKeyName: string
  apiKeyValue: string
  apiKeyIn: 'header' | 'query'
}

export const TEST_TARGETS = ['status', 'header', 'json', 'body', 'time'] as const
export type TestTarget = (typeof TEST_TARGETS)[number]

export const TEST_OPS = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'exists',
  'notExists',
  'lt',
  'gt',
  'setEnv'
] as const
export type TestOp = (typeof TEST_OPS)[number]

export interface TestRow {
  target: TestTarget
  /** Header name for `header`, JSON path for `json`; unused otherwise. */
  path: string
  op: TestOp
  /** Expected value, or the variable name for `setEnv`. */
  value: string
  enabled: boolean
}

export interface RequestDef {
  type: 'request'
  id: string
  name: string
  method: HttpMethod
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  body: RequestBody
  auth: Auth
  tests: TestRow[]
}

export interface Folder {
  type: 'folder'
  id: string
  name: string
  children: CollectionNode[]
}

export type CollectionNode = Folder | RequestDef

export interface Collection {
  restly: 1
  id: string
  name: string
  variables: KeyValue[]
  auth: Auth
  children: CollectionNode[]
}

export interface EnvVariable extends KeyValue {
  /** Secret values live in VS Code SecretStorage, never in the JSON file. */
  secret: boolean
}

export interface Environment {
  restly: 1
  id: string
  name: string
  variables: EnvVariable[]
}

export const GLOBAL_ENV_ID = 'global'

export interface HistoryEntry {
  id: string
  timestamp: number
  request: RequestDef
  status?: number
  durationMs?: number
  error?: string
}

export function emptyAuth(type: AuthType = 'inherit'): Auth {
  return {
    type,
    bearer: '',
    username: '',
    password: '',
    apiKeyName: '',
    apiKeyValue: '',
    apiKeyIn: 'header'
  }
}

export function emptyBody(): RequestBody {
  return {type: 'none', raw: '', form: [], multipart: [], file: ''}
}

export function newRequest(id: string, name = 'New Request'): RequestDef {
  return {
    type: 'request',
    id,
    name,
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    body: emptyBody(),
    auth: emptyAuth(),
    tests: []
  }
}

export function newCollection(id: string, name: string): Collection {
  return {restly: 1, id, name, variables: [], auth: emptyAuth('none'), children: []}
}

export function newEnvironment(id: string, name: string): Environment {
  return {restly: 1, id, name, variables: []}
}

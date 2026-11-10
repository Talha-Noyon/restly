import type {Auth, RequestDef} from './model'
import {Resolver, type Vars} from './vars'

export type PreparedBody =
  | {kind: 'none'}
  | {kind: 'text'; text: string}
  | {kind: 'form'; fields: [string, string][]}
  | {kind: 'multipart'; fields: {key: string; value: string; file: boolean}[]}
  | {kind: 'file'; path: string}

/** A request with variables substituted and auth applied: what goes on the wire. */
export interface PreparedRequest {
  method: string
  url: string
  headers: [string, string][]
  body: PreparedBody
}

export interface PrepareInput {
  request: RequestDef
  /** Auth of the owning collection, used when the request's auth is `inherit`. */
  collectionAuth?: Auth
  vars: Vars
  userAgent?: string
}

export interface PrepareResult {
  prepared: PreparedRequest
  unresolved: string[]
}

const CONTENT_TYPES: Partial<Record<RequestDef['body']['type'], string>> = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  form: 'application/x-www-form-urlencoded',
  binary: 'application/octet-stream'
}

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
}

export function getHeader(headers: [string, string][], name: string): string | undefined {
  const lower = name.toLowerCase()
  return headers.find(([k]) => k.toLowerCase() === lower)?.[1]
}

function appendQuery(url: string, key: string, value: string): string {
  const hashAt = url.indexOf('#')
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash}`
}

export function effectiveAuth(request: RequestDef, collectionAuth?: Auth): Auth | null {
  const auth = request.auth.type === 'inherit' ? collectionAuth : request.auth
  if (!auth || auth.type === 'none' || auth.type === 'inherit') return null
  return auth
}

export function prepareRequest(input: PrepareInput): PrepareResult {
  const {request} = input
  const r = new Resolver(input.vars)

  let url = r.resolve(request.url).trim()
  if (url && !hasScheme(url)) url = `http://${url}`

  const headers: [string, string][] = request.headers
    .filter((h) => h.enabled && h.key.trim())
    .map((h) => [r.resolve(h.key).trim(), r.resolve(h.value)])

  const auth = effectiveAuth(request, input.collectionAuth)
  if (auth && !getHeader(headers, 'authorization')) {
    if (auth.type === 'bearer') {
      headers.push(['Authorization', `Bearer ${r.resolve(auth.bearer)}`])
    } else if (auth.type === 'basic') {
      const credentials = `${r.resolve(auth.username)}:${r.resolve(auth.password)}`
      headers.push(['Authorization', `Basic ${toBase64(credentials)}`])
    }
  }
  if (auth?.type === 'apikey' && auth.apiKeyName) {
    const name = r.resolve(auth.apiKeyName)
    const value = r.resolve(auth.apiKeyValue)
    if (auth.apiKeyIn === 'query') url = appendQuery(url, name, value)
    else if (!getHeader(headers, name)) headers.push([name, value])
  }

  const b = request.body
  let body: PreparedBody
  switch (b.type) {
    case 'json':
    case 'text':
    case 'xml':
      body = {kind: 'text', text: r.resolve(b.raw)}
      break
    case 'form':
      body = {
        kind: 'form',
        fields: b.form
          .filter((f) => f.enabled && f.key)
          .map((f) => [r.resolve(f.key), r.resolve(f.value)])
      }
      break
    case 'multipart':
      body = {
        kind: 'multipart',
        fields: b.multipart
          .filter((f) => f.enabled && f.key)
          .map((f) => ({key: r.resolve(f.key), value: r.resolve(f.value), file: f.kind === 'file'}))
      }
      break
    case 'binary':
      body = b.file ? {kind: 'file', path: r.resolve(b.file)} : {kind: 'none'}
      break
    default:
      body = {kind: 'none'}
  }

  const contentType = CONTENT_TYPES[b.type]
  if (body.kind !== 'none' && contentType && !getHeader(headers, 'content-type')) {
    headers.push(['Content-Type', contentType])
  }
  if (!getHeader(headers, 'accept')) headers.push(['Accept', '*/*'])
  if (input.userAgent && !getHeader(headers, 'user-agent')) {
    headers.push(['User-Agent', input.userAgent])
  }

  return {
    prepared: {method: request.method, url, headers, body},
    unresolved: [...r.unresolved]
  }
}

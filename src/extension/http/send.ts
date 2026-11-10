import * as http from 'node:http'
import * as https from 'node:https'
import * as zlib from 'node:zlib'
import {readFile as fsReadFile} from 'node:fs/promises'
import type {PreparedBody, PreparedRequest} from '../../shared/prepare'
import {encodeMultipart, type ReadFile} from './multipart'

/*
 * Requests go through Node's http/https modules rather than fetch: VS Code
 * patches these to honour the user's `http.proxy` settings, and they let us
 * keep raw headers, skip TLS verification on request and measure timing.
 */

export interface SendOptions {
  timeoutMs: number
  followRedirects: boolean
  maxRedirects: number
  strictSSL: boolean
  signal?: AbortSignal
  readFile?: ReadFile
  /** Responses larger than this are aborted. */
  maxBodyBytes?: number
}

export interface HttpResult {
  status: number
  statusText: string
  headers: [string, string][]
  body: Buffer
  durationMs: number
  url: string
  redirects: number
}

export class RequestError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
  }
}

const DEFAULT_MAX_BODY = 100 * 1024 * 1024
const REDIRECTS = new Set([301, 302, 303, 307, 308])

type HeaderMap = Record<string, string | string[]>

function toHeaderMap(pairs: [string, string][]): HeaderMap {
  const out: HeaderMap = {}
  const names = new Map<string, string>()
  for (const [key, value] of pairs) {
    const lower = key.toLowerCase()
    const existing = names.get(lower)
    if (!existing) {
      names.set(lower, key)
      out[key] = value
    } else {
      const prev = out[existing]
      out[existing] = Array.isArray(prev) ? [...prev, value] : [prev, value]
    }
  }
  return out
}

function deleteHeader(headers: HeaderMap, name: string) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) delete headers[key]
  }
}

function hasHeader(headers: HeaderMap, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name)
}

async function encodeBody(
  body: PreparedBody,
  readFile: ReadFile
): Promise<{data?: Buffer; contentType?: string}> {
  const read: ReadFile = async (path) => {
    try {
      return await readFile(path)
    } catch (error) {
      throw new RequestError(`Cannot read file "${path}": ${(error as Error).message}`, 'EFILE')
    }
  }
  switch (body.kind) {
    case 'text':
      return {data: Buffer.from(body.text, 'utf8')}
    case 'form':
      return {data: Buffer.from(new URLSearchParams(body.fields).toString(), 'utf8')}
    case 'multipart':
      return encodeMultipart(body.fields, read)
    case 'file':
      return {data: await read(body.path)}
    default:
      return {}
  }
}

export function decompress(raw: Buffer, encoding: string): Buffer {
  if (raw.length === 0) return raw
  try {
    switch (encoding.trim().toLowerCase()) {
      case 'gzip':
      case 'x-gzip':
        return zlib.gunzipSync(raw)
      case 'deflate':
        try {
          return zlib.inflateSync(raw)
        } catch {
          return zlib.inflateRawSync(raw)
        }
      case 'br':
        return zlib.brotliDecompressSync(raw)
      default:
        return raw
    }
  } catch {
    // A server that lies about its encoding still gets its bytes shown.
    return raw
  }
}

interface Hop {
  status: number
  statusText: string
  headers: [string, string][]
  body: Buffer
  location?: string
}

function hop(
  method: string,
  url: URL,
  headers: HeaderMap,
  data: Buffer | undefined,
  options: SendOptions,
  signal: AbortSignal
): Promise<Hop> {
  return new Promise((resolve, reject) => {
    // Settle once: after an abort the socket still emits events we must ignore.
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const lib = url.protocol === 'https:' ? https : http
    const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY
    const req = lib.request(
      url,
      {method, headers, signal, rejectUnauthorized: options.strictSSL},
      (res) => {
        const chunks: Buffer[] = []
        let received = 0
        res.on('data', (chunk: Buffer) => {
          if (settled) return
          received += chunk.length
          if (received > maxBody) {
            fail(new RequestError(`Response is larger than ${maxBody} bytes; aborted`, 'ETOOLARGE'))
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        res.on('error', fail)
        res.on('end', () => {
          if (settled) return
          settled = true
          const pairs: [string, string][] = []
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            pairs.push([res.rawHeaders[i], res.rawHeaders[i + 1]])
          }
          const encoding = res.headers['content-encoding'] ?? ''
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: pairs,
            body: decompress(Buffer.concat(chunks), encoding),
            location: res.headers.location
          })
        })
      }
    )
    req.on('error', fail)
    req.end(data)
  })
}

function describeError(error: unknown, url: URL): RequestError {
  if (error instanceof RequestError) return error
  const err = error as NodeJS.ErrnoException
  const code = err.code ?? 'EUNKNOWN'
  const host = url.host
  if (code === 'ECONNREFUSED') {
    return new RequestError(`Connection refused: nothing is listening at ${host}`, code)
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new RequestError(`Could not resolve host "${url.hostname}"`, code)
  }
  if (code === 'ECONNRESET') return new RequestError('Connection reset by the server', code)
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return new RequestError(`Host ${host} is unreachable`, code)
  }
  if (
    code.startsWith('CERT_') ||
    code.startsWith('ERR_TLS') ||
    code.includes('SELF_SIGNED') ||
    code.startsWith('UNABLE_TO_') ||
    code.startsWith('DEPTH_ZERO')
  ) {
    return new RequestError(
      `TLS error: ${err.message}. Turn off the "restly.strictSSL" setting to accept self-signed certificates.`,
      code
    )
  }
  return new RequestError(err.message || String(error), code)
}

export function parseRequestUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new RequestError(`Invalid URL: "${raw}"`, 'EINVALIDURL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RequestError(`Unsupported protocol "${url.protocol}"; use http or https`, 'EPROTOCOL')
  }
  return url
}

export async function sendRequest(req: PreparedRequest, options: SendOptions): Promise<HttpResult> {
  if (!req.url) throw new RequestError('Enter a URL first', 'EINVALIDURL')
  let url = parseRequestUrl(req.url)
  const encoded = await encodeBody(req.body, options.readFile ?? fsReadFile)

  const headers = toHeaderMap(req.headers)
  if (encoded.contentType) {
    deleteHeader(headers, 'content-type')
    headers['Content-Type'] = encoded.contentType
  }
  if (!hasHeader(headers, 'accept-encoding')) headers['Accept-Encoding'] = 'gzip, deflate, br'
  let data = encoded.data
  if (data) {
    deleteHeader(headers, 'content-length')
    headers['Content-Length'] = String(data.length)
  }

  const controller = new AbortController()
  let reason: 'cancelled' | 'timeout' | null = null
  const onAbort = () => {
    reason = 'cancelled'
    controller.abort()
  }
  if (options.signal?.aborted) onAbort()
  options.signal?.addEventListener('abort', onAbort)
  const timer =
    options.timeoutMs > 0
      ? setTimeout(() => {
          reason = 'timeout'
          controller.abort()
        }, options.timeoutMs)
      : undefined

  const start = performance.now()
  let method = req.method
  try {
    for (let redirects = 0; ; redirects++) {
      let res: Hop
      try {
        res = await hop(method, url, headers, data, options, controller.signal)
      } catch (error) {
        if (reason === 'cancelled') throw new RequestError('Request cancelled', 'ECANCELLED')
        if (reason === 'timeout') {
          throw new RequestError(`Request timed out after ${options.timeoutMs} ms`, 'ETIMEDOUT')
        }
        throw describeError(error, url)
      }

      if (options.followRedirects && REDIRECTS.has(res.status) && res.location) {
        if (redirects >= options.maxRedirects) {
          throw new RequestError(`Too many redirects (limit ${options.maxRedirects})`, 'EREDIRECTS')
        }
        const next = new URL(res.location, url)
        const switchToGet =
          res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')
        if (switchToGet) {
          if (method !== 'HEAD') method = 'GET'
          data = undefined
          deleteHeader(headers, 'content-type')
          deleteHeader(headers, 'content-length')
        }
        if (next.origin !== url.origin) {
          // Never hand credentials to a different host.
          deleteHeader(headers, 'authorization')
          deleteHeader(headers, 'cookie')
        }
        url = next
        continue
      }

      return {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        body: res.body,
        durationMs: performance.now() - start,
        url: url.href,
        redirects
      }
    }
  } finally {
    if (timer) clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

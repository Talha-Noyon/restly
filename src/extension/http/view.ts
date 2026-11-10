import type {ResponseView} from '../../shared/messages'
import type {HttpResult} from './send'

/** Text beyond this is cut before it reaches the webview; Save keeps the whole body. */
export const TEXT_LIMIT = 2 * 1024 * 1024
const IMAGE_LIMIT = 10 * 1024 * 1024

const TEXT_TYPES = /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|yaml|csv|graphql/i

export function headerValue(headers: [string, string][], name: string): string {
  const lower = name.toLowerCase()
  return headers.find(([k]) => k.toLowerCase() === lower)?.[1] ?? ''
}

function looksBinary(body: Buffer): boolean {
  const sample = body.subarray(0, 1024)
  return sample.includes(0)
}

export function decodeText(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(body)
  } catch {
    return new TextDecoder('utf-8').decode(body)
  }
}

export function bodyKind(body: Buffer, contentType: string): ResponseView['bodyKind'] {
  const mime = contentType.split(';')[0].trim().toLowerCase()
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'image'
  if (TEXT_TYPES.test(mime) || mime === 'image/svg+xml') return 'text'
  if (!mime) return looksBinary(body) ? 'binary' : 'text'
  return looksBinary(body) ? 'binary' : 'text'
}

export function toResponseView(result: HttpResult): ResponseView {
  const contentType = headerValue(result.headers, 'content-type')
  const kind = bodyKind(result.body, contentType)
  const truncated = kind === 'text' && result.body.length > TEXT_LIMIT
  return {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
    durationMs: result.durationMs,
    size: result.body.length,
    url: result.url,
    redirects: result.redirects,
    contentType,
    bodyKind: kind,
    bodyText:
      kind === 'text'
        ? decodeText(truncated ? result.body.subarray(0, TEXT_LIMIT) : result.body, contentType)
        : '',
    bodyBase64:
      kind === 'image' && result.body.length <= IMAGE_LIMIT ? result.body.toString('base64') : '',
    truncated
  }
}

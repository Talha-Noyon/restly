import {randomBytes} from 'node:crypto'

export type ReadFile = (path: string) => Promise<Buffer>

const MIME: Record<string, string> = {
  json: 'application/json',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  xml: 'application/xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg'
}

export function guessMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || 'file'
}

/** Quoting rules from the HTML spec for multipart/form-data names and filenames. */
function escapeName(value: string): string {
  return value.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

export async function encodeMultipart(
  fields: {key: string; value: string; file: boolean}[],
  readFile: ReadFile,
  boundary = `----RestlyBoundary${randomBytes(12).toString('hex')}`
): Promise<{data: Buffer; contentType: string}> {
  const parts: Buffer[] = []
  for (const field of fields) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeName(field.key)}"`
    let content: Buffer
    if (field.file) {
      content = await readFile(field.value)
      head += `; filename="${escapeName(basename(field.value))}"\r\nContent-Type: ${guessMimeType(field.value)}`
    } else {
      content = Buffer.from(field.value, 'utf8')
    }
    parts.push(Buffer.from(`${head}\r\n\r\n`, 'utf8'), content, Buffer.from('\r\n', 'utf8'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
  return {data: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}`}
}

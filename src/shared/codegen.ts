import type {PreparedRequest} from './prepare'

export const CODEGEN_TARGETS = [
  {id: 'curl', label: 'cURL'},
  {id: 'fetch', label: 'JavaScript - fetch'},
  {id: 'axios', label: 'JavaScript - axios'},
  {id: 'python', label: 'Python - requests'}
] as const
export type CodegenTarget = (typeof CODEGEN_TARGETS)[number]['id']

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const lit = (value: string) => JSON.stringify(value)

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || 'file'
}

/** Headers minus Content-Type for multipart, where the client must add the boundary itself. */
function wireHeaders(req: PreparedRequest): [string, string][] {
  if (req.body.kind !== 'multipart') return req.headers
  return req.headers.filter(([k]) => k.toLowerCase() !== 'content-type')
}

export function toCurl(req: PreparedRequest): string {
  const parts: string[] = []
  if (req.method === 'HEAD') parts.push('curl -I')
  else if (req.method === 'GET') parts.push('curl')
  else parts.push(`curl -X ${req.method}`)
  parts[0] += ` ${shellQuote(req.url)}`

  for (const [k, v] of wireHeaders(req)) parts.push(`-H ${shellQuote(`${k}: ${v}`)}`)

  const body = req.body
  switch (body.kind) {
    case 'text':
      parts.push(`--data-raw ${shellQuote(body.text)}`)
      break
    case 'form':
      for (const [k, v] of body.fields) parts.push(`--data-urlencode ${shellQuote(`${k}=${v}`)}`)
      break
    case 'multipart':
      for (const f of body.fields) {
        parts.push(`-F ${shellQuote(`${f.key}=${f.file ? '@' : ''}${f.value}`)}`)
      }
      break
    case 'file':
      parts.push(`--data-binary ${shellQuote(`@${body.path}`)}`)
      break
  }
  return parts.join(' \\\n  ')
}

function jsHeaders(headers: [string, string][], indent: string): string {
  if (headers.length === 0) return '{}'
  const rows = headers.map(([k, v]) => `${indent}  ${lit(k)}: ${lit(v)}`)
  return `{\n${rows.join(',\n')}\n${indent}}`
}

/** Lines that build a `body` / `form` value for JS, plus the expression to send. */
function jsBody(req: PreparedRequest): {setup: string[]; expr: string | null; usesFs: boolean} {
  const body = req.body
  switch (body.kind) {
    case 'text':
      return {setup: [], expr: lit(body.text), usesFs: false}
    case 'form': {
      const pairs = body.fields.map(([k, v]) => `[${lit(k)}, ${lit(v)}]`).join(', ')
      return {setup: [], expr: `new URLSearchParams([${pairs}])`, usesFs: false}
    }
    case 'multipart': {
      const setup = ['const form = new FormData()']
      let usesFs = false
      for (const f of body.fields) {
        if (f.file) {
          usesFs = true
          setup.push(
            `form.append(${lit(f.key)}, new Blob([fs.readFileSync(${lit(f.value)})]), ${lit(basename(f.value))})`
          )
        } else {
          setup.push(`form.append(${lit(f.key)}, ${lit(f.value)})`)
        }
      }
      return {setup, expr: 'form', usesFs}
    }
    case 'file':
      return {setup: [], expr: `fs.readFileSync(${lit(body.path)})`, usesFs: true}
    default:
      return {setup: [], expr: null, usesFs: false}
  }
}

export function toFetch(req: PreparedRequest): string {
  const {setup, expr, usesFs} = jsBody(req)
  const lines: string[] = []
  if (usesFs) lines.push("import fs from 'node:fs'", '')
  if (setup.length) lines.push(...setup, '')
  const options = [
    `  method: ${lit(req.method)}`,
    `  headers: ${jsHeaders(wireHeaders(req), '  ')}`
  ]
  if (expr) options.push(`  body: ${expr}`)
  lines.push(`const response = await fetch(${lit(req.url)}, {`, options.join(',\n'), '})')
  lines.push('const data = await response.text()', 'console.log(response.status, data)')
  return lines.join('\n')
}

export function toAxios(req: PreparedRequest): string {
  const {setup, expr, usesFs} = jsBody(req)
  const lines: string[] = ["import axios from 'axios'"]
  if (usesFs) lines.push("import fs from 'node:fs'")
  lines.push('')
  if (setup.length) lines.push(...setup, '')
  const options = [
    `  method: ${lit(req.method.toLowerCase())}`,
    `  url: ${lit(req.url)}`,
    `  headers: ${jsHeaders(wireHeaders(req), '  ')}`
  ]
  if (expr) options.push(`  data: ${expr}`)
  lines.push('const response = await axios({', options.join(',\n'), '})')
  lines.push('console.log(response.status, response.data)')
  return lines.join('\n')
}

export function toPython(req: PreparedRequest): string {
  const lines = ['import requests', '', `url = ${lit(req.url)}`]
  const headers = wireHeaders(req)
  if (headers.length) {
    lines.push('headers = {', ...headers.map(([k, v]) => `    ${lit(k)}: ${lit(v)},`), '}')
  } else {
    lines.push('headers = {}')
  }

  const args = ['url', 'headers=headers']
  const body = req.body
  switch (body.kind) {
    case 'text':
      lines.push(`data = ${lit(body.text)}`)
      args.push('data=data.encode("utf-8")')
      break
    case 'form':
      lines.push(`data = [${body.fields.map(([k, v]) => `(${lit(k)}, ${lit(v)})`).join(', ')}]`)
      args.push('data=data')
      break
    case 'multipart':
      lines.push(
        'files = [',
        ...body.fields.map((f) =>
          f.file
            ? `    (${lit(f.key)}, (${lit(basename(f.value))}, open(${lit(f.value)}, "rb"))),`
            : `    (${lit(f.key)}, (None, ${lit(f.value)})),`
        ),
        ']'
      )
      args.push('files=files')
      break
    case 'file':
      lines.push(`data = open(${lit(body.path)}, "rb")`)
      args.push('data=data')
      break
  }
  lines.push(
    '',
    `response = requests.request(${lit(req.method)}, ${args.join(', ')})`,
    'print(response.status_code)',
    'print(response.text)'
  )
  return lines.join('\n')
}

export function generateCode(target: CodegenTarget, req: PreparedRequest): string {
  switch (target) {
    case 'curl':
      return toCurl(req)
    case 'fetch':
      return toFetch(req)
    case 'axios':
      return toAxios(req)
    case 'python':
      return toPython(req)
  }
}

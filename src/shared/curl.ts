import {
  HTTP_METHODS,
  emptyAuth,
  emptyBody,
  type HttpMethod,
  type KeyValue,
  type MultipartField,
  type RequestDef
} from './model'
import {newId} from './id'
import {parseQuery} from './url'

export class CurlParseError extends Error {}

/** Splits a shell command into words: bash, Windows cmd and PowerShell continuations. */
export function tokenize(input: string): string[] {
  let text = input.trim()
  // Chrome's "Copy as cURL (cmd)" escapes with ^; undo it before normal parsing.
  if (/\^\r?\n/.test(text) || /^curl\s+\^"/.test(text)) {
    text = text.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1')
  }
  text = text.replace(/\\\r?\n/g, ' ').replace(/`\r?\n/g, ' ')

  const tokens: string[] = []
  let current = ''
  let inToken = false
  let i = 0
  const push = () => {
    if (inToken) tokens.push(current)
    current = ''
    inToken = false
  }

  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      push()
      i++
    } else if (ch === "'") {
      inToken = true
      const end = text.indexOf("'", i + 1)
      if (end < 0) throw new CurlParseError('Unclosed single quote')
      current += text.slice(i + 1, end)
      i = end + 1
    } else if (ch === '$' && text[i + 1] === "'") {
      inToken = true
      i += 2
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && i + 1 < text.length) {
          const [value, used] = ansiEscape(text, i + 1)
          current += value
          i += 1 + used
        } else {
          current += text[i++]
        }
      }
      if (i >= text.length) throw new CurlParseError("Unclosed $'...' quote")
      i++
    } else if (ch === '"') {
      inToken = true
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && /["\\$`]/.test(text[i + 1] ?? '')) {
          current += text[i + 1]
          i += 2
        } else {
          current += text[i++]
        }
      }
      if (i >= text.length) throw new CurlParseError('Unclosed double quote')
      i++
    } else if (ch === '\\' && !inToken && /\s/.test(text[i + 1] ?? '')) {
      // A continuation whose newline was flattened by a single-line input box
      // (`url' \  -H`). Inside a word, `\ ` stays an escaped space.
      push()
      i += 2
    } else if (ch === '\\' && i + 1 < text.length) {
      inToken = true
      current += text[i + 1]
      i += 2
    } else {
      inToken = true
      current += ch
      i++
    }
  }
  push()
  return tokens
}

function ansiEscape(text: string, at: number): [string, number] {
  const c = text[at]
  const simple: Record<string, string> = {n: '\n', t: '\t', r: '\r', '0': '\0', "'": "'", '"': '"'}
  if (c in simple) return [simple[c], 1]
  if (c === '\\') return ['\\', 1]
  if (c === 'x') {
    const hex = /^[0-9a-fA-F]{1,2}/.exec(text.slice(at + 1))?.[0]
    if (hex) return [String.fromCharCode(parseInt(hex, 16)), 1 + hex.length]
  }
  if (c === 'u') {
    const hex = /^[0-9a-fA-F]{1,4}/.exec(text.slice(at + 1))?.[0]
    if (hex) return [String.fromCharCode(parseInt(hex, 16)), 1 + hex.length]
  }
  return ['\\' + c, 1]
}

const SHORT_WITH_ARG = new Set('XHdFuAbeomwxTcEK')
const LONG_WITH_ARG = new Set([
  'request',
  'header',
  'data',
  'data-raw',
  'data-ascii',
  'data-binary',
  'data-urlencode',
  'json',
  'form',
  'form-string',
  'user',
  'user-agent',
  'cookie',
  'referer',
  'url',
  'oauth2-bearer',
  'upload-file',
  'output',
  'max-time',
  'connect-timeout',
  'write-out',
  'proxy',
  'retry',
  'cookie-jar',
  'cacert',
  'cert',
  'key',
  'config',
  'resolve',
  'limit-rate'
])
const SHORT_TO_LONG: Record<string, string> = {
  X: 'request',
  H: 'header',
  d: 'data',
  F: 'form',
  u: 'user',
  A: 'user-agent',
  b: 'cookie',
  e: 'referer',
  T: 'upload-file',
  I: 'head',
  G: 'get'
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function requestName(method: string, url: string): string {
  const path = url.replace(/^[a-z]+:\/\//i, '').split(/[?#]/)[0]
  const segments = path.split('/').filter(Boolean)
  const last = segments.length > 1 ? segments[segments.length - 1] : segments[0]
  return `${method} ${last || 'request'}`
}

export function isCurlCommand(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text)
}

export function parseCurl(command: string): RequestDef {
  const tokens = tokenize(command)
  if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0])) {
    throw new CurlParseError('Not a curl command')
  }

  const opts: {name: string; value: string}[] = []
  const positional: string[] = []
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok.startsWith('--') && tok.length > 2) {
      const eq = tok.indexOf('=')
      const name = eq > 0 ? tok.slice(2, eq) : tok.slice(2)
      if (eq > 0) opts.push({name, value: tok.slice(eq + 1)})
      else if (LONG_WITH_ARG.has(name)) opts.push({name, value: tokens[++i] ?? ''})
      else opts.push({name, value: ''})
    } else if (tok.startsWith('-') && tok.length > 1) {
      for (let j = 1; j < tok.length; j++) {
        const flag = tok[j]
        const name = SHORT_TO_LONG[flag] ?? flag
        if (SHORT_WITH_ARG.has(flag)) {
          const attached = tok.slice(j + 1)
          opts.push({name, value: attached || (tokens[++i] ?? '')})
          break
        }
        opts.push({name, value: ''})
      }
    } else {
      positional.push(tok)
    }
  }

  let method: string | undefined
  let url = positional[0] ?? ''
  const headers: KeyValue[] = []
  const data: string[] = []
  const urlencoded: KeyValue[] = []
  const multipart: MultipartField[] = []
  let binaryFile = ''
  let isJson = false
  let head = false
  let get = false
  const auth = emptyAuth()

  for (const {name, value} of opts) {
    switch (name) {
      case 'request':
        method = value.toUpperCase()
        break
      case 'url':
        url = value
        break
      case 'header': {
        const colon = value.indexOf(':')
        if (colon > 0) {
          headers.push({
            key: value.slice(0, colon).trim(),
            value: value.slice(colon + 1).trim(),
            enabled: true
          })
        }
        break
      }
      case 'user-agent':
        headers.push({key: 'User-Agent', value, enabled: true})
        break
      case 'referer':
        headers.push({key: 'Referer', value, enabled: true})
        break
      case 'cookie':
        if (value.includes('=')) headers.push({key: 'Cookie', value, enabled: true})
        break
      case 'json':
        isJson = true
        data.push(value)
        break
      case 'data':
      case 'data-raw':
      case 'data-ascii':
      case 'data-binary':
        if (value.startsWith('@') && name !== 'data-raw') binaryFile = value.slice(1)
        else data.push(value)
        break
      case 'data-urlencode': {
        const eq = value.indexOf('=')
        if (eq > 0)
          urlencoded.push({key: value.slice(0, eq), value: value.slice(eq + 1), enabled: true})
        else urlencoded.push({key: value.replace(/^=/, ''), value: '', enabled: true})
        break
      }
      case 'form':
      case 'form-string': {
        const eq = value.indexOf('=')
        if (eq <= 0) break
        const key = value.slice(0, eq)
        const raw = value.slice(eq + 1)
        if (name === 'form' && raw.startsWith('@')) {
          multipart.push({key, value: raw.slice(1).split(';')[0], kind: 'file', enabled: true})
        } else {
          multipart.push({key, value: raw, kind: 'text', enabled: true})
        }
        break
      }
      case 'upload-file':
        binaryFile = value
        method ??= 'PUT'
        break
      case 'user': {
        const colon = value.indexOf(':')
        auth.type = 'basic'
        auth.username = colon >= 0 ? value.slice(0, colon) : value
        auth.password = colon >= 0 ? value.slice(colon + 1) : ''
        break
      }
      case 'oauth2-bearer':
        auth.type = 'bearer'
        auth.bearer = value
        break
      case 'head':
        head = true
        break
      case 'get':
        get = true
        break
    }
  }

  if (!url) throw new CurlParseError('No URL found in curl command')

  const contentType = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  if (isJson) {
    if (!contentType) headers.push({key: 'Content-Type', value: 'application/json', enabled: true})
    if (!headers.some((h) => h.key.toLowerCase() === 'accept')) {
      headers.push({key: 'Accept', value: 'application/json', enabled: true})
    }
  }

  const hasBody = data.length > 0 || urlencoded.length > 0 || multipart.length > 0 || !!binaryFile
  if (get && (data.length || urlencoded.length)) {
    const query = [...data, ...urlencoded.map((f) => `${f.key}=${encodeURIComponent(f.value)}`)]
    url += (url.includes('?') ? '&' : '?') + query.join('&')
    data.length = 0
    urlencoded.length = 0
  }

  const resolvedMethod = (method ??
    (head ? 'HEAD' : get ? 'GET' : hasBody ? 'POST' : 'GET')) as HttpMethod
  const finalMethod: HttpMethod = (HTTP_METHODS as readonly string[]).includes(resolvedMethod)
    ? resolvedMethod
    : 'GET'

  const body = emptyBody()
  const joined = data.join('&')
  if (multipart.length) {
    body.type = 'multipart'
    body.multipart = multipart
  } else if (binaryFile && !data.length) {
    body.type = 'binary'
    body.file = binaryFile
  } else if (urlencoded.length || (joined && !isJson && looksLikeForm(joined, contentType))) {
    body.type = 'form'
    const fromData = joined
      ? joined.split('&').map((pair) => {
          const eq = pair.indexOf('=')
          return eq < 0
            ? {key: safeDecode(pair), value: '', enabled: true}
            : {
                key: safeDecode(pair.slice(0, eq)),
                value: safeDecode(pair.slice(eq + 1)),
                enabled: true
              }
        })
      : []
    body.form = [...fromData, ...urlencoded]
  } else if (joined) {
    const ct = contentType.toLowerCase()
    if (isJson || ct.includes('json')) {
      body.type = 'json'
      body.raw = prettyJson(joined)
    } else if (ct.includes('xml')) {
      body.type = 'xml'
      body.raw = joined
    } else {
      body.type = 'text'
      body.raw = joined
    }
  }

  return {
    type: 'request',
    id: newId(),
    name: requestName(finalMethod, url),
    method: finalMethod,
    url,
    params: parseQuery(url),
    headers,
    body,
    auth,
    tests: []
  }
}

function looksLikeForm(data: string, contentType: string): boolean {
  const ct = contentType.toLowerCase()
  if (ct && !ct.includes('x-www-form-urlencoded')) return false
  return /^[^=&\s{}[\]"]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(data)
}

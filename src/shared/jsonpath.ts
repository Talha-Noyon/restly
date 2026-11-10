export type PathSegment = string | number

/**
 * Parses a small JSONPath subset: `$.a.b[0]["key with space"].c`. The leading
 * `$` and `.` are optional, so `data.items[0].id` and `data.items.0.id` work too.
 */
export function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = []
  let rest = path.trim()
  if (rest.startsWith('$')) rest = rest.slice(1)
  let i = 0
  while (i < rest.length) {
    const ch = rest[i]
    if (ch === '.') {
      i++
    } else if (ch === '[') {
      const close = rest.indexOf(']', i)
      if (close < 0) throw new Error(`Unclosed [ in path "${path}"`)
      const inner = rest.slice(i + 1, close).trim()
      const quoted = /^(['"])(.*)\1$/.exec(inner)
      if (quoted) segments.push(quoted[2])
      else if (/^-?\d+$/.test(inner)) segments.push(Number(inner))
      else segments.push(inner)
      i = close + 1
    } else {
      let j = i
      while (j < rest.length && rest[j] !== '.' && rest[j] !== '[') j++
      const name = rest.slice(i, j)
      segments.push(/^\d+$/.test(name) ? Number(name) : name)
      i = j
    }
  }
  return segments
}

export function getPath(value: unknown, path: string): {found: boolean; value: unknown} {
  let current: unknown = value
  for (const seg of parsePath(path)) {
    if (current === null || current === undefined) return {found: false, value: undefined}
    if (seg === 'length' && (Array.isArray(current) || typeof current === 'string')) {
      current = current.length
      continue
    }
    if (Array.isArray(current)) {
      const index = typeof seg === 'number' ? seg : Number(seg)
      if (!Number.isInteger(index)) return {found: false, value: undefined}
      const at = index < 0 ? current.length + index : index
      if (at < 0 || at >= current.length) return {found: false, value: undefined}
      current = current[at]
    } else if (typeof current === 'object') {
      const key = String(seg)
      if (!Object.prototype.hasOwnProperty.call(current, key))
        return {found: false, value: undefined}
      current = (current as Record<string, unknown>)[key]
    } else {
      return {found: false, value: undefined}
    }
  }
  return {found: true, value: current}
}

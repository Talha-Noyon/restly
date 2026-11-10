import type {KeyValue} from './model'

/*
 * The URL bar and the Params table edit the same query string. Values are kept
 * exactly as typed (no decoding), so `{{vars}}` and pre-encoded text survive a
 * round trip; encoding happens once, when the request is sent.
 */

function split(url: string): {base: string; query: string; hash: string} {
  let rest = url
  let hash = ''
  const hashAt = rest.indexOf('#')
  if (hashAt >= 0) {
    hash = rest.slice(hashAt)
    rest = rest.slice(0, hashAt)
  }
  const queryAt = rest.indexOf('?')
  if (queryAt < 0) return {base: rest, query: '', hash}
  return {base: rest.slice(0, queryAt), query: rest.slice(queryAt + 1), hash}
}

export function parseQuery(url: string): KeyValue[] {
  const {query} = split(url)
  if (!query) return []
  return query
    .split('&')
    .filter((part) => part.length > 0)
    .map((part) => {
      const eq = part.indexOf('=')
      return eq < 0
        ? {key: part, value: '', enabled: true}
        : {key: part.slice(0, eq), value: part.slice(eq + 1), enabled: true}
    })
}

export function buildUrl(url: string, params: KeyValue[]): string {
  const {base, hash} = split(url)
  const query = params
    .filter((p) => p.enabled && (p.key || p.value))
    .map((p) => (p.value === '' ? p.key : `${p.key}=${p.value}`))
    .join('&')
  return `${base}${query ? `?${query}` : ''}${hash}`
}

/** New params after the URL was edited: parsed ones, plus disabled rows kept from before. */
export function syncParamsFromUrl(url: string, previous: KeyValue[]): KeyValue[] {
  return [...parseQuery(url), ...previous.filter((p) => !p.enabled)]
}

import type {KeyValue} from './model'
import {newId} from './id'

export type Vars = Record<string, string>

const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g
const MAX_DEPTH = 5

/**
 * Builds one lookup table from variable layers, highest priority first.
 * Disabled and keyless rows are skipped; an earlier layer always wins.
 */
export function mergeVars(...layers: KeyValue[][]): Vars {
  const out: Vars = {}
  for (const layer of layers) {
    for (const v of layer) {
      if (!v.enabled || !v.key || v.key in out) continue
      out[v.key] = v.value
    }
  }
  return out
}

export function dynamicVar(name: string): string | undefined {
  switch (name) {
    case '$guid':
    case '$uuid':
      return newId()
    case '$timestamp':
      return String(Math.floor(Date.now() / 1000))
    case '$isoTimestamp':
      return new Date().toISOString()
    case '$randomInt':
      return String(Math.floor(Math.random() * 1001))
    default:
      return undefined
  }
}

export class Resolver {
  readonly unresolved = new Set<string>()

  constructor(private readonly vars: Vars) {}

  /** Replaces every `{{name}}`. Unknown names stay as written and are recorded. */
  resolve(text: string, depth = 0): string {
    if (!text.includes('{{')) return text
    return text.replace(VAR_RE, (match, rawName: string) => {
      const name = rawName.trim()
      const value = Object.prototype.hasOwnProperty.call(this.vars, name)
        ? this.vars[name]
        : dynamicVar(name)
      if (value === undefined) {
        this.unresolved.add(name)
        return match
      }
      return depth < MAX_DEPTH ? this.resolve(value, depth + 1) : value
    })
  }
}

/** Names of every `{{var}}` in the text, used for highlighting in the editor. */
export function findVarNames(text: string): string[] {
  return [...text.matchAll(VAR_RE)].map((m) => m[1].trim())
}

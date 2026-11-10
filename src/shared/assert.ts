import type {TestOp, TestRow} from './model'
import {getPath} from './jsonpath'

export interface ResponseFacts {
  status: number
  headers: [string, string][]
  body: string
  durationMs: number
}

export interface TestResult {
  label: string
  pass: boolean
  actual: string
  message?: string
}

export interface TestRun {
  results: TestResult[]
  /** Variables to write into the active environment (`setEnv` rows). */
  setEnv: {key: string; value: string}[]
}

export const OP_LABELS: Record<TestOp, string> = {
  equals: 'equals',
  notEquals: 'not equals',
  contains: 'contains',
  notContains: 'not contains',
  exists: 'exists',
  notExists: 'does not exist',
  lt: '<',
  gt: '>',
  setEnv: 'set env var'
}

const MISSING = Symbol('missing')
type Actual = unknown | typeof MISSING

function display(v: Actual): string {
  if (v === MISSING) return '(missing)'
  if (v === undefined) return 'undefined'
  const text = typeof v === 'string' ? v : JSON.stringify(v)
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

function asVarValue(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  )
}

function equals(actual: unknown, expected: string): boolean {
  if (typeof actual === 'string') return actual === expected
  if (typeof actual === 'number') return expected.trim() !== '' && Number(expected) === actual
  if (typeof actual === 'boolean' || actual === null) return String(actual) === expected.trim()
  try {
    return deepEqual(actual, JSON.parse(expected))
  } catch {
    return false
  }
}

function contains(actual: unknown, expected: string): boolean {
  if (typeof actual === 'string') return actual.includes(expected)
  if (Array.isArray(actual)) return actual.some((item) => equals(item, expected))
  if (actual && typeof actual === 'object')
    return Object.prototype.hasOwnProperty.call(actual, expected)
  return String(actual).includes(expected)
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}

export function testLabel(row: TestRow): string {
  const target = row.path ? `${row.target} ${row.path}` : row.target
  if (row.op === 'exists' || row.op === 'notExists') return `${target} ${OP_LABELS[row.op]}`
  if (row.op === 'setEnv') return `${target} → {{${row.value}}}`
  return `${target} ${OP_LABELS[row.op]} ${row.value}`
}

/**
 * Evaluates the enabled test rows against a response. `resolve` substitutes
 * `{{vars}}` in expected values.
 */
export function runTests(
  rows: TestRow[],
  res: ResponseFacts,
  resolve: (text: string) => string = (t) => t
): TestRun {
  const run: TestRun = {results: [], setEnv: []}
  let json: {ok: true; value: unknown} | {ok: false} | undefined

  const parseJson = () => {
    if (!json) {
      try {
        json = {ok: true, value: JSON.parse(res.body)}
      } catch {
        json = {ok: false}
      }
    }
    return json
  }

  for (const row of rows) {
    if (!row.enabled) continue
    const label = testLabel(row)
    let actual: Actual
    try {
      switch (row.target) {
        case 'status':
          actual = res.status
          break
        case 'time':
          actual = Math.round(res.durationMs)
          break
        case 'body':
          actual = res.body
          break
        case 'header': {
          const name = row.path.trim().toLowerCase()
          const found = res.headers.find(([k]) => k.toLowerCase() === name)
          actual = found ? found[1] : MISSING
          break
        }
        case 'json': {
          const parsed = parseJson()
          if (!parsed.ok) {
            run.results.push({label, pass: false, actual: '', message: 'Response body is not JSON'})
            continue
          }
          const got = getPath(parsed.value, row.path || '$')
          actual = got.found ? got.value : MISSING
          break
        }
      }
    } catch (error) {
      run.results.push({label, pass: false, actual: '', message: (error as Error).message})
      continue
    }

    const expected = resolve(row.value)
    let pass: boolean
    let message: string | undefined
    switch (row.op) {
      case 'exists':
        pass = actual !== MISSING
        break
      case 'notExists':
        pass = actual === MISSING
        break
      case 'setEnv':
        if (actual === MISSING) {
          pass = false
          message = 'Nothing to store: value is missing'
        } else if (!row.value.trim()) {
          pass = false
          message = 'No variable name given'
        } else {
          pass = true
          run.setEnv.push({key: row.value.trim(), value: asVarValue(actual)})
        }
        break
      case 'equals':
        pass = actual !== MISSING && equals(actual, expected)
        break
      case 'notEquals':
        pass = actual === MISSING || !equals(actual, expected)
        break
      case 'contains':
        pass = actual !== MISSING && contains(actual, expected)
        break
      case 'notContains':
        pass = actual === MISSING || !contains(actual, expected)
        break
      case 'lt':
      case 'gt': {
        const a = toNumber(actual)
        const b = toNumber(expected)
        if (a === null || b === null) {
          pass = false
          message = 'Both sides must be numbers'
        } else {
          pass = row.op === 'lt' ? a < b : a > b
        }
        break
      }
    }
    run.results.push({label, pass, actual: display(actual), message})
  }
  return run
}

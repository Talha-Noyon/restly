import type {TestOp, TestRow, TestTarget} from '../../shared/model'
import {OP_LABELS} from '../../shared/assert'
import {Select} from './common'

const TARGETS: {value: TestTarget; label: string}[] = [
  {value: 'status', label: 'Status code'},
  {value: 'header', label: 'Header'},
  {value: 'json', label: 'JSON body'},
  {value: 'body', label: 'Body text'},
  {value: 'time', label: 'Time (ms)'}
]

const OPS: {value: TestOp; label: string}[] = (Object.keys(OP_LABELS) as TestOp[]).map((op) => ({
  value: op,
  label: OP_LABELS[op]
}))

const needsPath = (target: TestTarget) => target === 'header' || target === 'json'
const needsValue = (op: TestOp) => op !== 'exists' && op !== 'notExists'

export function TestsEditor({
  tests,
  onChange
}: {
  tests: TestRow[]
  onChange: (tests: TestRow[]) => void
}) {
  const update = (index: number, patch: Partial<TestRow>) =>
    onChange(tests.map((t, i) => (i === index ? {...t, ...patch} : t)))

  const add = () =>
    onChange([...tests, {target: 'status', path: '', op: 'equals', value: '200', enabled: true}])

  return (
    <div class="tests-editor">
      <p class="hint">
        Checks run after every response. <b>set env var</b> stores a value, such as a login token,
        in the active environment (or Global). JSON paths look like <code>$.data[0].id</code>.
      </p>
      {tests.length > 0 && (
        <table class="kv-table">
          <tbody>
            {tests.map((row, index) => (
              <tr key={index} class={row.enabled ? '' : 'disabled'}>
                <td class="kv-check">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) =>
                      update(index, {enabled: (e.target as HTMLInputElement).checked})
                    }
                  />
                </td>
                <td class="tests-target">
                  <Select
                    value={row.target}
                    options={TARGETS}
                    onChange={(target) => update(index, {target})}
                  />
                </td>
                <td>
                  {needsPath(row.target) && (
                    <input
                      class="input"
                      value={row.path}
                      placeholder={row.target === 'json' ? '$.data.id' : 'Content-Type'}
                      spellcheck={false}
                      onInput={(e) => update(index, {path: (e.target as HTMLInputElement).value})}
                    />
                  )}
                </td>
                <td class="tests-op">
                  <Select value={row.op} options={OPS} onChange={(op) => update(index, {op})} />
                </td>
                <td>
                  {needsValue(row.op) && (
                    <input
                      class="input"
                      value={row.value}
                      placeholder={row.op === 'setEnv' ? 'variable name' : 'expected'}
                      spellcheck={false}
                      onInput={(e) => update(index, {value: (e.target as HTMLInputElement).value})}
                    />
                  )}
                </td>
                <td class="kv-actions">
                  <button
                    class="icon-btn"
                    title="Remove"
                    onClick={() => onChange(tests.filter((_, i) => i !== index))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button class="btn secondary" onClick={add}>
        + Add test
      </button>
    </div>
  )
}

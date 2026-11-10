import {useState} from 'preact/hooks'
import type {KeyValue} from '../../shared/model'

interface Props {
  rows: KeyValue[]
  onChange: (rows: KeyValue[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  /** id of a <datalist> offering key suggestions. */
  keyList?: string
}

/** Rows as `key: value`, one per line; disabled rows start with `//`. */
export function toBulk(rows: KeyValue[]): string {
  return rows
    .filter((r) => r.key || r.value)
    .map((r) => `${r.enabled ? '' : '// '}${r.key}: ${r.value}`)
    .join('\n')
}

export function fromBulk(text: string): KeyValue[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const disabled = line.startsWith('//')
      const body = disabled ? line.slice(2).trim() : line
      const colon = body.indexOf(':')
      return colon < 0
        ? {key: body, value: '', enabled: !disabled}
        : {
            key: body.slice(0, colon).trim(),
            value: body.slice(colon + 1).trim(),
            enabled: !disabled
          }
    })
}

export function KeyValueTable({
  rows,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  keyList
}: Props) {
  const [bulk, setBulk] = useState<string | null>(null)

  // A blank row at the end; typing into it creates a real row.
  const display = [...rows, {key: '', value: '', enabled: true}]

  const update = (index: number, patch: Partial<KeyValue>) => {
    const next = rows.slice()
    if (index >= rows.length) next.push({key: '', value: '', enabled: true, ...patch})
    else next[index] = {...next[index], ...patch}
    onChange(next)
  }

  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index))

  return (
    <div class="kv">
      <div class="kv-toolbar">
        <button
          class="link"
          onClick={() => {
            if (bulk === null) setBulk(toBulk(rows))
            else {
              onChange(fromBulk(bulk))
              setBulk(null)
            }
          }}
        >
          {bulk === null ? 'Bulk edit' : 'Key-value edit'}
        </button>
      </div>
      {bulk !== null ? (
        <textarea
          class="bulk"
          value={bulk}
          spellcheck={false}
          placeholder={'key: value\n// disabled: row'}
          onInput={(e) => {
            const text = (e.target as HTMLTextAreaElement).value
            setBulk(text)
            onChange(fromBulk(text))
          }}
        />
      ) : (
        <table class="kv-table">
          <tbody>
            {display.map((row, index) => {
              const isNew = index >= rows.length
              return (
                <tr key={index} class={row.enabled || isNew ? '' : 'disabled'}>
                  <td class="kv-check">
                    {!isNew && (
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        title={row.enabled ? 'Disable' : 'Enable'}
                        onChange={(e) =>
                          update(index, {enabled: (e.target as HTMLInputElement).checked})
                        }
                      />
                    )}
                  </td>
                  <td>
                    <input
                      class="input"
                      value={row.key}
                      placeholder={keyPlaceholder}
                      list={keyList}
                      spellcheck={false}
                      onInput={(e) => update(index, {key: (e.target as HTMLInputElement).value})}
                    />
                  </td>
                  <td>
                    <input
                      class="input"
                      value={row.value}
                      placeholder={valuePlaceholder}
                      spellcheck={false}
                      onInput={(e) => update(index, {value: (e.target as HTMLInputElement).value})}
                    />
                  </td>
                  <td class="kv-actions">
                    {!isNew && (
                      <button class="icon-btn" title="Remove" onClick={() => remove(index)}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export const COMMON_HEADERS = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'Cookie',
  'If-Match',
  'If-None-Match',
  'Origin',
  'Referer',
  'User-Agent',
  'X-Api-Key',
  'X-Requested-With'
]

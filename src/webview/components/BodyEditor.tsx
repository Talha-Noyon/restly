import type {BodyType, MultipartField, RequestBody} from '../../shared/model'
import {CodeEditor, type Language} from './CodeEditor'
import {KeyValueTable} from './KeyValueTable'
import {Empty, Select} from './common'

const TYPES: {value: BodyType; label: string}[] = [
  {value: 'none', label: 'None'},
  {value: 'json', label: 'JSON'},
  {value: 'text', label: 'Text'},
  {value: 'xml', label: 'XML'},
  {value: 'form', label: 'Form URL-encoded'},
  {value: 'multipart', label: 'Multipart form'},
  {value: 'binary', label: 'Binary file'}
]

interface Props {
  body: RequestBody
  onChange: (body: RequestBody) => void
  /** Asks the host for a file path; the answer arrives through `filePicked`. */
  onPickFile: (token: string) => void
}

export function BodyEditor({body, onChange, onPickFile}: Props) {
  const set = (patch: Partial<RequestBody>) => onChange({...body, ...patch})

  let content
  switch (body.type) {
    case 'json':
    case 'text':
    case 'xml': {
      const language: Language = body.type === 'text' ? 'text' : body.type
      content = (
        <div class="editor-fill">
          <CodeEditor
            value={body.raw}
            language={language}
            onChange={(raw) => set({raw})}
            placeholder={body.type === 'json' ? '{\n  "key": "{{variable}}"\n}' : ''}
          />
        </div>
      )
      break
    }
    case 'form':
      content = (
        <KeyValueTable rows={body.form} onChange={(form) => set({form})} keyPlaceholder="Field" />
      )
      break
    case 'multipart':
      content = (
        <MultipartTable
          rows={body.multipart}
          onChange={(multipart) => set({multipart})}
          onPickFile={onPickFile}
        />
      )
      break
    case 'binary':
      content = (
        <div class="file-row">
          <input
            class="input"
            value={body.file}
            placeholder="Path of the file to send"
            onInput={(e) => set({file: (e.target as HTMLInputElement).value})}
          />
          <button class="btn secondary" onClick={() => onPickFile('binary')}>
            Browse…
          </button>
        </div>
      )
      break
    default:
      content = <Empty>This request has no body.</Empty>
  }

  const formatJson = () => {
    try {
      set({raw: JSON.stringify(JSON.parse(body.raw), null, 2)})
    } catch {
      // invalid JSON stays as typed; the editor shows where it breaks
    }
  }

  return (
    <div class="body-editor">
      <div class="body-toolbar">
        <Select
          value={body.type}
          options={TYPES}
          onChange={(type) => set({type})}
          title="Body type"
        />
        {body.type === 'json' && (
          <button class="link" onClick={formatJson}>
            Format
          </button>
        )}
      </div>
      {content}
    </div>
  )
}

function MultipartTable({
  rows,
  onChange,
  onPickFile
}: {
  rows: MultipartField[]
  onChange: (rows: MultipartField[]) => void
  onPickFile: (token: string) => void
}) {
  const display = [...rows, {key: '', value: '', kind: 'text' as const, enabled: true}]
  const update = (index: number, patch: Partial<MultipartField>) => {
    const next = rows.slice()
    if (index >= rows.length) next.push({key: '', value: '', kind: 'text', enabled: true, ...patch})
    else next[index] = {...next[index], ...patch}
    onChange(next)
  }
  return (
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
                  placeholder="Field"
                  onInput={(e) => update(index, {key: (e.target as HTMLInputElement).value})}
                />
              </td>
              <td class="kv-kind">
                <Select
                  value={row.kind}
                  options={[
                    {value: 'text', label: 'Text'},
                    {value: 'file', label: 'File'}
                  ]}
                  onChange={(kind) => update(index, {kind})}
                />
              </td>
              <td>
                <div class="file-row">
                  <input
                    class="input"
                    value={row.value}
                    placeholder={row.kind === 'file' ? 'File path' : 'Value'}
                    onInput={(e) => update(index, {value: (e.target as HTMLInputElement).value})}
                  />
                  {row.kind === 'file' && (
                    <button
                      class="btn secondary"
                      onClick={() => {
                        if (isNew) update(index, {kind: 'file'})
                        onPickFile(`multipart:${index}`)
                      }}
                    >
                      Browse…
                    </button>
                  )}
                </div>
              </td>
              <td class="kv-actions">
                {!isNew && (
                  <button
                    class="icon-btn"
                    title="Remove"
                    onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

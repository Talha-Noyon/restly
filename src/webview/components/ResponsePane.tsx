import {useMemo, useState} from 'preact/hooks'
import type {ResponseView} from '../../shared/messages'
import type {TestResult} from '../../shared/assert'
import {formatBytes, formatDuration} from '../../shared/format'
import {CodeEditor, type Language} from './CodeEditor'
import {Empty, Tabs} from './common'

export type ResponseState =
  | {phase: 'idle'}
  | {phase: 'sending'}
  | {phase: 'error'; message: string; code?: string; unresolved: string[]}
  | {phase: 'done'; response: ResponseView; tests: TestResult[]; unresolved: string[]}

type Tab = 'body' | 'headers' | 'tests'

interface Props {
  state: ResponseState
  onCancel: () => void
  onCopy: (text: string) => void
  onSave: () => void
}

function statusClass(status: number): string {
  if (status >= 500) return 's5'
  if (status >= 400) return 's4'
  if (status >= 300) return 's3'
  if (status >= 200) return 's2'
  return 's1'
}

function languageFor(contentType: string): Language {
  const ct = contentType.toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('html')) return 'html'
  if (ct.includes('xml') || ct.includes('svg')) return 'xml'
  return 'text'
}

function prettify(text: string, language: Language): string {
  if (language !== 'json') return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function UnresolvedNote({names}: {names: string[]}) {
  if (!names.length) return null
  return (
    <div class="note warn">
      Unresolved variables sent as written: {names.map((n) => `{{${n}}}`).join(', ')}
    </div>
  )
}

export function ResponsePane({state, onCancel, onCopy, onSave}: Props) {
  const [tab, setTab] = useState<Tab>('body')
  const [raw, setRaw] = useState(false)
  const [wrap, setWrap] = useState(true)

  const response = state.phase === 'done' ? state.response : null
  const language = response ? languageFor(response.contentType) : 'text'
  // Guess JSON from the body when the server sent no useful content type.
  const sniffed: Language =
    language === 'text' && response && /^\s*[{[]/.test(response.bodyText) ? 'json' : language
  const pretty = useMemo(
    () => (response ? prettify(response.bodyText, sniffed) : ''),
    [response, sniffed]
  )

  if (state.phase === 'idle') {
    return (
      <Empty>
        <div class="empty-title">Send a request to see the response</div>
        <div>
          <kbd>Ctrl</kbd> + <kbd>Enter</kbd> sends · <kbd>Ctrl</kbd> + <kbd>S</kbd> saves
        </div>
      </Empty>
    )
  }
  if (state.phase === 'sending') {
    return (
      <Empty>
        <div class="spinner" />
        <div class="empty-title">Sending…</div>
        <button class="btn secondary" onClick={onCancel}>
          Cancel
        </button>
      </Empty>
    )
  }
  if (state.phase === 'error') {
    return (
      <div class="response">
        <div class="error-box">
          <div class="error-title">Request failed{state.code ? ` (${state.code})` : ''}</div>
          <div>{state.message}</div>
        </div>
        <UnresolvedNote names={state.unresolved} />
      </div>
    )
  }

  const r = state.response
  const passed = state.tests.filter((t) => t.pass).length
  const body = raw ? r.bodyText : pretty

  return (
    <div class="response">
      <div class="status-line">
        <span class={`status ${statusClass(r.status)}`}>
          {r.status} {r.statusText}
        </span>
        <span class="meta">{formatDuration(r.durationMs)}</span>
        <span class="meta">{formatBytes(r.size)}</span>
        {r.redirects > 0 && (
          <span class="meta" title={r.url}>
            {r.redirects} redirect{r.redirects === 1 ? '' : 's'}
          </span>
        )}
        <span class="spacer" />
        {r.bodyKind === 'text' && (
          <button class="link" onClick={() => onCopy(r.bodyText)}>
            Copy
          </button>
        )}
        <button class="link" onClick={onSave}>
          Save
        </button>
      </div>
      <UnresolvedNote names={state.unresolved} />
      <Tabs<Tab>
        tabs={[
          {id: 'body', label: 'Body'},
          {id: 'headers', label: 'Headers', badge: r.headers.length},
          {
            id: 'tests',
            label: 'Tests',
            badge: state.tests.length ? `${passed}/${state.tests.length}` : ''
          }
        ]}
        active={tab}
        onSelect={setTab}
        extra={
          tab === 'body' && r.bodyKind === 'text' ? (
            <>
              <label class="toggle">
                <input type="checkbox" checked={raw} onChange={() => setRaw(!raw)} /> Raw
              </label>
              <label class="toggle">
                <input type="checkbox" checked={wrap} onChange={() => setWrap(!wrap)} /> Wrap
              </label>
            </>
          ) : null
        }
      />
      <div class="tab-body">
        {tab === 'body' && r.bodyKind === 'text' && (
          <>
            {r.truncated && (
              <div class="note">Showing the first 2 MB. Use Save to get the whole body.</div>
            )}
            {r.size === 0 ? (
              <Empty>Empty body</Empty>
            ) : (
              <div class="editor-fill">
                <CodeEditor value={body} language={raw ? 'text' : sniffed} readOnly wrap={wrap} />
              </div>
            )}
          </>
        )}
        {tab === 'body' && r.bodyKind === 'image' && (
          <div class="image-preview">
            {r.bodyBase64 ? (
              <img
                src={`data:${r.contentType.split(';')[0]};base64,${r.bodyBase64}`}
                alt="Response"
              />
            ) : (
              <Empty>Image too large to preview. Use Save.</Empty>
            )}
          </div>
        )}
        {tab === 'body' && r.bodyKind === 'binary' && (
          <Empty>
            Binary response ({formatBytes(r.size)}, {r.contentType || 'unknown type'}).
            <button class="btn secondary" onClick={onSave}>
              Save to file…
            </button>
          </Empty>
        )}
        {tab === 'headers' && (
          <table class="headers-table">
            <tbody>
              {r.headers.map(([k, v], i) => (
                <tr key={i}>
                  <td class="header-name">{k}</td>
                  <td class="header-value">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'tests' &&
          (state.tests.length === 0 ? (
            <Empty>No tests. Add some in the request's Tests tab.</Empty>
          ) : (
            <ul class="test-results">
              {state.tests.map((t, i) => (
                <li key={i} class={t.pass ? 'pass' : 'fail'}>
                  <span class="test-icon">{t.pass ? '✓' : '✗'}</span>
                  <span class="test-label">{t.label}</span>
                  {!t.pass && <span class="test-detail">{t.message ?? `actual: ${t.actual}`}</span>}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  )
}

import {useEffect, useMemo, useRef, useState} from 'preact/hooks'
import {HTTP_METHODS, type HttpMethod, type RequestDef} from '../shared/model'
import type {FromRequestView, ToRequestView} from '../shared/messages'
import {CODEGEN_TARGETS, type CodegenTarget} from '../shared/codegen'
import {buildUrl, syncParamsFromUrl} from '../shared/url'
import {findVarNames} from '../shared/vars'
import {isCurlCommand, parseCurl} from '../shared/curl'
import {post, useHostMessages, useShortcuts} from './vscode'
import {KeyValueTable, COMMON_HEADERS} from './components/KeyValueTable'
import {BodyEditor} from './components/BodyEditor'
import {AuthEditor} from './components/AuthEditor'
import {TestsEditor} from './components/TestsEditor'
import {ResponsePane, type ResponseState} from './components/ResponsePane'
import {CodeEditor} from './components/CodeEditor'
import {Select, Tabs} from './components/common'

type ReqTab = 'params' | 'headers' | 'body' | 'auth' | 'tests' | 'code'

const send = (message: FromRequestView) => post<FromRequestView>(message)

const BODY_LABELS: Record<RequestDef['body']['type'], string> = {
  none: '',
  json: 'JSON',
  text: 'Text',
  xml: 'XML',
  form: 'Form',
  multipart: 'Multipart',
  binary: 'File'
}

const AUTH_LABELS: Record<RequestDef['auth']['type'], string> = {
  inherit: '',
  none: 'None',
  bearer: 'Bearer',
  basic: 'Basic',
  apikey: 'Key'
}

export function RequestApp() {
  const [request, setRequest] = useState<RequestDef | null>(null)
  const [baseline, setBaseline] = useState('')
  const [location, setLocation] = useState<string | null>(null)
  const [variables, setVariables] = useState<string[]>([])
  const [tab, setTab] = useState<ReqTab>('params')
  const [response, setResponse] = useState<ResponseState>({phase: 'idle'})
  const [code, setCode] = useState<{target: CodegenTarget; text: string}>({
    target: 'curl',
    text: ''
  })
  const [notice, setNotice] = useState('')
  const [wide, setWide] = useState(window.innerWidth >= 900)
  const [ratio, setRatio] = useState(0.5)
  const splitRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(request)
  requestRef.current = request

  useHostMessages<ToRequestView>((m) => {
    switch (m.type) {
      case 'init': {
        // Hand-written or older files may carry a query string the Params table never saw.
        const request = {...m.request, params: syncParamsFromUrl(m.request.url, m.request.params)}
        setRequest(request)
        setBaseline(JSON.stringify(request))
        setLocation(m.location)
        setVariables(m.variables)
        if (m.request.body.type !== 'none') setTab('body')
        break
      }
      case 'sending':
        setResponse({phase: 'sending'})
        break
      case 'response':
        setResponse({phase: 'done', response: m.response, tests: m.tests, unresolved: m.unresolved})
        break
      case 'error':
        setResponse({phase: 'error', message: m.message, code: m.code, unresolved: m.unresolved})
        break
      case 'saved':
        setRequest(m.request)
        setBaseline(JSON.stringify(m.request))
        setLocation(m.location)
        break
      case 'renamed':
        setRequest((r) => r && {...r, name: m.name})
        setBaseline((b) => (b ? JSON.stringify({...JSON.parse(b), name: m.name}) : b))
        setLocation(m.location)
        break
      case 'filePicked':
        applyFile(m.token, m.path)
        break
      case 'code':
        setCode({target: m.target, text: m.code})
        break
      case 'variables':
        setVariables(m.names)
        break
    }
  })

  useEffect(() => send({type: 'ready'}), [])

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const dirty = request !== null && JSON.stringify(request) !== baseline

  // Tell the host when the tab title has to change.
  const lastPosted = useRef('')
  useEffect(() => {
    if (!request) return
    const key = `${dirty}|${request.name}`
    if (key === lastPosted.current) return
    lastPosted.current = key
    send({type: 'dirty', dirty, request})
  }, [dirty, request?.name])

  // Regenerate the snippet while the Code tab is open.
  useEffect(() => {
    if (tab !== 'code' || !request) return
    const timer = setTimeout(() => send({type: 'codegen', target: code.target, request}), 200)
    return () => clearTimeout(timer)
  }, [tab, request, code.target])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const doSend = () => {
    const r = requestRef.current
    if (r) send({type: 'send', request: r})
  }
  const doSave = () => {
    const r = requestRef.current
    if (r) send({type: 'save', request: r})
  }
  useShortcuts({onSave: doSave, onSend: doSend})

  const update = (patch: Partial<RequestDef>) => setRequest((r) => r && {...r, ...patch})

  function applyFile(token: string, path: string) {
    setRequest((r) => {
      if (!r) return r
      if (token === 'binary') return {...r, body: {...r.body, file: path}}
      if (token.startsWith('multipart:')) {
        const index = Number(token.slice('multipart:'.length))
        const multipart = r.body.multipart.slice()
        if (multipart[index]) multipart[index] = {...multipart[index], value: path, kind: 'file'}
        else multipart.push({key: 'file', value: path, kind: 'file', enabled: true})
        return {...r, body: {...r.body, multipart}}
      }
      return r
    })
  }

  const unknownVars = useMemo(() => {
    if (!request) return []
    const texts = [
      request.url,
      ...request.headers.filter((h) => h.enabled).flatMap((h) => [h.key, h.value]),
      ...(['json', 'text', 'xml'].includes(request.body.type) ? [request.body.raw] : []),
      ...(request.body.type === 'form' ? request.body.form.map((f) => f.value) : []),
      request.auth.bearer,
      request.auth.username,
      request.auth.password,
      request.auth.apiKeyValue
    ]
    const known = new Set(variables)
    const names = new Set(texts.flatMap(findVarNames))
    return [...names].filter((n) => !known.has(n) && !n.startsWith('$'))
  }, [request, variables])

  if (!request) return <div class="loading">Loading…</div>

  const onUrlPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text') ?? ''
    if (!isCurlCommand(text)) return
    e.preventDefault()
    try {
      const parsed = parseCurl(text)
      setRequest(
        (r) =>
          r && {
            ...parsed,
            id: r.id,
            name: r.name === 'New Request' ? parsed.name : r.name,
            tests: r.tests
          }
      )
      setNotice('Imported from cURL')
    } catch (error) {
      setNotice(`Could not read cURL: ${(error as Error).message}`)
    }
  }

  const startDrag = (e: PointerEvent) => {
    e.preventDefault()
    const box = splitRef.current!.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      const r = wide ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height
      setRatio(Math.min(0.8, Math.max(0.2, r)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const enabledCount = (rows: {enabled: boolean; key: string}[]) =>
    rows.filter((r) => r.enabled && r.key).length

  return (
    <div class="app">
      <header class="topbar">
        <input
          class="name-input"
          value={request.name}
          size={Math.max(8, request.name.length + 1)}
          title="Request name"
          spellcheck={false}
          onInput={(e) => update({name: (e.target as HTMLInputElement).value})}
        />
        <span class="location" title={location ?? 'Not saved in a collection'}>
          {location ?? 'Unsaved'}
        </span>
        <span class="spacer" />
        {dirty && (
          <span class="dirty" title="Unsaved changes">
            ●
          </span>
        )}
        <button class="btn secondary" onClick={doSave} title="Save (Ctrl+S)">
          Save
        </button>
      </header>

      <div class="urlbar">
        <select
          class={`method m-${request.method}`}
          value={request.method}
          onChange={(e) => update({method: (e.target as HTMLSelectElement).value as HttpMethod})}
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          class="url"
          value={request.url}
          placeholder="https://api.example.com/users  ·  or paste a cURL command"
          spellcheck={false}
          autoFocus
          onPaste={onUrlPaste}
          onInput={(e) => {
            const url = (e.target as HTMLInputElement).value
            setRequest((r) => r && {...r, url, params: syncParamsFromUrl(url, r.params)})
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) doSend()
          }}
        />
        {response.phase === 'sending' ? (
          <button class="btn danger" onClick={() => send({type: 'cancel'})}>
            Cancel
          </button>
        ) : (
          <button class="btn primary" onClick={doSend} title="Send (Ctrl+Enter)">
            Send
          </button>
        )}
      </div>
      {(notice || unknownVars.length > 0) && (
        <div class="hints">
          {notice && <span class="note">{notice}</span>}
          {unknownVars.length > 0 && (
            <span class="note warn">
              Unknown variable{unknownVars.length === 1 ? '' : 's'}:{' '}
              {unknownVars.map((n) => `{{${n}}}`).join(', ')}
            </span>
          )}
        </div>
      )}

      <div class={`split ${wide ? 'wide' : 'tall'}`} ref={splitRef}>
        <section class="pane" style={{flexBasis: `${ratio * 100}%`}}>
          <Tabs<ReqTab>
            tabs={[
              {id: 'params', label: 'Params', badge: enabledCount(request.params)},
              {id: 'headers', label: 'Headers', badge: enabledCount(request.headers)},
              {id: 'body', label: 'Body', badge: BODY_LABELS[request.body.type]},
              {id: 'auth', label: 'Auth', badge: AUTH_LABELS[request.auth.type]},
              {id: 'tests', label: 'Tests', badge: request.tests.filter((t) => t.enabled).length},
              {id: 'code', label: 'Code'}
            ]}
            active={tab}
            onSelect={setTab}
          />
          <div class="tab-body">
            {tab === 'params' && (
              <KeyValueTable
                rows={request.params}
                onChange={(params) =>
                  setRequest((r) => r && {...r, params, url: buildUrl(r.url, params)})
                }
                keyPlaceholder="Parameter"
              />
            )}
            {tab === 'headers' && (
              <>
                <KeyValueTable
                  rows={request.headers}
                  onChange={(headers) => update({headers})}
                  keyPlaceholder="Header"
                  keyList="restly-headers"
                />
                <datalist id="restly-headers">
                  {COMMON_HEADERS.map((h) => (
                    <option key={h} value={h} />
                  ))}
                </datalist>
              </>
            )}
            {tab === 'body' && (
              <BodyEditor
                body={request.body}
                onChange={(body) => update({body})}
                onPickFile={(token) => send({type: 'pickFile', token})}
              />
            )}
            {tab === 'auth' && (
              <AuthEditor auth={request.auth} onChange={(auth) => update({auth})} />
            )}
            {tab === 'tests' && (
              <TestsEditor tests={request.tests} onChange={(tests) => update({tests})} />
            )}
            {tab === 'code' && (
              <div class="code-tab">
                <div class="body-toolbar">
                  <Select
                    value={code.target}
                    options={CODEGEN_TARGETS.map((t) => ({value: t.id, label: t.label}))}
                    onChange={(target) => setCode((c) => ({...c, target}))}
                  />
                  <button class="link" onClick={() => send({type: 'copy', text: code.text})}>
                    Copy
                  </button>
                  <span class="hint">Variables are filled in from the active environment.</span>
                </div>
                <div class="editor-fill">
                  <CodeEditor value={code.text} language="text" readOnly wrap />
                </div>
              </div>
            )}
          </div>
        </section>
        <div class="splitter" onPointerDown={startDrag} />
        <section class="pane grow">
          <ResponsePane
            state={response}
            onCancel={() => send({type: 'cancel'})}
            onCopy={(text) => send({type: 'copy', text})}
            onSave={() => send({type: 'saveResponse'})}
          />
        </section>
      </div>
    </div>
  )
}

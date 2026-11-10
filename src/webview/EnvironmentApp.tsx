import {useEffect, useRef, useState} from 'preact/hooks'
import type {EnvVariable, Environment} from '../shared/model'
import type {FromEnvironmentView, ToEnvironmentView} from '../shared/messages'
import {post, useHostMessages, useShortcuts} from './vscode'

const send = (message: FromEnvironmentView) => post<FromEnvironmentView>(message)

export function EnvironmentApp() {
  const [env, setEnv] = useState<Environment | null>(null)
  const [baseline, setBaseline] = useState('')
  const [isGlobal, setIsGlobal] = useState(false)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const envRef = useRef(env)
  envRef.current = env

  useHostMessages<ToEnvironmentView>((m) => {
    if (m.type === 'init') {
      setEnv(m.environment)
      setBaseline(JSON.stringify(m.environment))
      setIsGlobal(m.isGlobal)
    } else if (m.type === 'saved') {
      setEnv(m.environment)
      setBaseline(JSON.stringify(m.environment))
    }
  })

  useEffect(() => send({type: 'ready'}), [])

  const dirty = env !== null && JSON.stringify(env) !== baseline
  const lastDirty = useRef(false)
  useEffect(() => {
    if (dirty === lastDirty.current) return
    lastDirty.current = dirty
    send({type: 'dirty', dirty})
  }, [dirty])

  const save = () => {
    if (envRef.current) send({type: 'save', environment: envRef.current})
  }
  useShortcuts({onSave: save})

  if (!env) return <div class="loading">Loading…</div>

  const rows: EnvVariable[] = [...env.variables, {key: '', value: '', enabled: true, secret: false}]
  const update = (index: number, patch: Partial<EnvVariable>) => {
    setEnv((e) => {
      if (!e) return e
      const variables = e.variables.slice()
      if (index >= variables.length) {
        variables.push({key: '', value: '', enabled: true, secret: false, ...patch})
      } else {
        variables[index] = {...variables[index], ...patch}
      }
      return {...e, variables}
    })
  }
  const remove = (index: number) =>
    setEnv((e) => e && {...e, variables: e.variables.filter((_, i) => i !== index)})
  const toggleReveal = (index: number) =>
    setRevealed((s) => {
      const next = new Set(s)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  return (
    <div class="app env-app">
      <header class="topbar">
        <input
          class="name-input"
          value={env.name}
          size={Math.max(8, env.name.length + 1)}
          disabled={isGlobal}
          title={isGlobal ? 'The Global environment cannot be renamed' : 'Environment name'}
          onInput={(e) => setEnv({...env, name: (e.target as HTMLInputElement).value})}
        />
        <span class="location">{isGlobal ? 'Applied to every request' : 'Environment'}</span>
        <span class="spacer" />
        {dirty && (
          <span class="dirty" title="Unsaved changes">
            ●
          </span>
        )}
        <button class="btn primary" onClick={save} title="Save (Ctrl+S)">
          Save
        </button>
      </header>
      <p class="hint env-hint">
        Use <code>{'{{name}}'}</code> in URLs, headers, bodies and auth. Lookup order: active
        environment, then collection variables, then Global. <b>Secret</b> values are kept in VS
        Code's secret storage and never written to disk with the rest of the environment.
      </p>
      <div class="env-table-wrap">
        <table class="kv-table env-table">
          <thead>
            <tr>
              <th />
              <th>Variable</th>
              <th>Value</th>
              <th class="center">Secret</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const isNew = index >= env.variables.length
              const masked = row.secret && !revealed.has(index)
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
                      placeholder="name"
                      spellcheck={false}
                      onInput={(e) => update(index, {key: (e.target as HTMLInputElement).value})}
                    />
                  </td>
                  <td>
                    <div class="file-row">
                      <input
                        class="input"
                        type={masked ? 'password' : 'text'}
                        value={row.value}
                        placeholder="value"
                        spellcheck={false}
                        onInput={(e) =>
                          update(index, {value: (e.target as HTMLInputElement).value})
                        }
                      />
                      {row.secret && (
                        <button class="link" onClick={() => toggleReveal(index)}>
                          {masked ? 'Show' : 'Hide'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td class="center">
                    {!isNew && (
                      <input
                        type="checkbox"
                        checked={row.secret}
                        title="Keep the value in secret storage"
                        onChange={(e) =>
                          update(index, {secret: (e.target as HTMLInputElement).checked})
                        }
                      />
                    )}
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
      </div>
    </div>
  )
}

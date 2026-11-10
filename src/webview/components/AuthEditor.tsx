import type {Auth, AuthType} from '../../shared/model'
import {Empty, Select} from './common'

const TYPES: {value: AuthType; label: string}[] = [
  {value: 'inherit', label: 'Inherit from collection'},
  {value: 'none', label: 'No auth'},
  {value: 'bearer', label: 'Bearer token'},
  {value: 'basic', label: 'Basic auth'},
  {value: 'apikey', label: 'API key'}
]

function Field({
  label,
  value,
  onInput,
  type = 'text',
  placeholder
}: {
  label: string
  value: string
  onInput: (value: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <label class="field">
      <span class="field-label">{label}</span>
      <input
        class="input"
        type={type}
        value={value}
        placeholder={placeholder}
        spellcheck={false}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      />
    </label>
  )
}

export function AuthEditor({auth, onChange}: {auth: Auth; onChange: (auth: Auth) => void}) {
  const set = (patch: Partial<Auth>) => onChange({...auth, ...patch})
  return (
    <div class="auth-editor">
      <div class="body-toolbar">
        <Select
          value={auth.type}
          options={TYPES}
          onChange={(type) => set({type})}
          title="Auth type"
        />
      </div>
      {auth.type === 'inherit' && (
        <Empty>Uses the auth set on the collection. Unsaved requests send no auth.</Empty>
      )}
      {auth.type === 'none' && <Empty>No Authorization header is added.</Empty>}
      {auth.type === 'bearer' && (
        <Field
          label="Token"
          value={auth.bearer}
          placeholder="{{token}}"
          onInput={(bearer) => set({bearer})}
        />
      )}
      {auth.type === 'basic' && (
        <>
          <Field label="Username" value={auth.username} onInput={(username) => set({username})} />
          <Field
            label="Password"
            type="password"
            value={auth.password}
            onInput={(password) => set({password})}
          />
        </>
      )}
      {auth.type === 'apikey' && (
        <>
          <Field
            label="Key"
            value={auth.apiKeyName}
            placeholder="X-Api-Key"
            onInput={(apiKeyName) => set({apiKeyName})}
          />
          <Field
            label="Value"
            value={auth.apiKeyValue}
            placeholder="{{apiKey}}"
            onInput={(apiKeyValue) => set({apiKeyValue})}
          />
          <label class="field">
            <span class="field-label">Add to</span>
            <Select
              value={auth.apiKeyIn}
              options={[
                {value: 'header', label: 'Header'},
                {value: 'query', label: 'Query params'}
              ]}
              onChange={(apiKeyIn) => set({apiKeyIn})}
            />
          </label>
        </>
      )}
    </div>
  )
}

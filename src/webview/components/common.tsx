import type {ComponentChildren} from 'preact'

export interface TabDef<T extends string> {
  id: T
  label: string
  badge?: string | number
}

export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
  extra
}: {
  tabs: TabDef<T>[]
  active: T
  onSelect: (id: T) => void
  extra?: ComponentChildren
}) {
  return (
    <div class="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === active}
          class={`tab${tab.id === active ? ' active' : ''}`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge !== '' && tab.badge !== 0 && (
            <span class="badge">{tab.badge}</span>
          )}
        </button>
      ))}
      {extra && <div class="tabs-extra">{extra}</div>}
    </div>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  class: className,
  title
}: {
  value: T
  options: readonly {value: T; label: string}[]
  onChange: (value: T) => void
  class?: string
  title?: string
}) {
  return (
    <select
      class={`select${className ? ` ${className}` : ''}`}
      value={value}
      title={title}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Empty({children}: {children: ComponentChildren}) {
  return <div class="empty">{children}</div>
}

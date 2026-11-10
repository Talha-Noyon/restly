import {useEffect, useRef} from 'preact/hooks'

interface VsCodeApi {
  postMessage(message: unknown): void
}

declare function acquireVsCodeApi(): VsCodeApi

const api = acquireVsCodeApi()

export function post<T>(message: T): void {
  api.postMessage(message)
}

/** Subscribes to messages from the extension host for the component's lifetime. */
export function useHostMessages<T>(handler: (message: T) => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const listener = (event: MessageEvent) => ref.current(event.data as T)
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [])
}

/** Runs `onSave` on Ctrl/Cmd+S and `onSend` on Ctrl/Cmd+Enter anywhere in the page. */
export function useShortcuts(shortcuts: {onSave?: () => void; onSend?: () => void}): void {
  const ref = useRef(shortcuts)
  ref.current = shortcuts
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === 's' || e.key === 'S') {
        if (!ref.current.onSave) return
        e.preventDefault()
        ref.current.onSave()
      } else if (e.key === 'Enter') {
        if (!ref.current.onSend) return
        e.preventDefault()
        ref.current.onSend()
      }
    }
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])
}

import type {Environment, RequestDef} from './model'
import type {TestResult} from './assert'
import type {CodegenTarget} from './codegen'

export interface ResponseView {
  status: number
  statusText: string
  headers: [string, string][]
  durationMs: number
  /** Decoded body size in bytes. */
  size: number
  /** Final URL after redirects. */
  url: string
  redirects: number
  contentType: string
  bodyKind: 'text' | 'image' | 'binary'
  bodyText: string
  bodyBase64: string
  /** True when bodyText was cut to keep the webview responsive. */
  truncated: boolean
}

/** Extension host → request editor webview. */
export type ToRequestView =
  | {
      type: 'init'
      request: RequestDef
      /** "Collection / Folder" the request is saved in, or null when unsaved. */
      location: string | null
      variables: string[]
    }
  | {type: 'sending'}
  | {type: 'response'; response: ResponseView; tests: TestResult[]; unresolved: string[]}
  | {type: 'error'; message: string; code?: string; unresolved: string[]}
  | {type: 'saved'; request: RequestDef; location: string}
  /** The request was renamed or moved from the sidebar while open. */
  | {type: 'renamed'; name: string; location: string | null}
  | {type: 'filePicked'; token: string; path: string}
  | {type: 'code'; target: CodegenTarget; code: string}
  | {type: 'variables'; names: string[]}

/** Request editor webview → extension host. */
export type FromRequestView =
  | {type: 'ready'}
  | {type: 'send'; request: RequestDef}
  | {type: 'cancel'}
  | {type: 'save'; request: RequestDef}
  | {type: 'dirty'; dirty: boolean; request: RequestDef}
  | {type: 'pickFile'; token: string}
  | {type: 'codegen'; target: CodegenTarget; request: RequestDef}
  | {type: 'copy'; text: string}
  | {type: 'saveResponse'}

/** Extension host → environment editor webview. */
export type ToEnvironmentView =
  | {type: 'init'; environment: Environment; isGlobal: boolean}
  | {type: 'saved'; environment: Environment}

/** Environment editor webview → extension host. */
export type FromEnvironmentView =
  {type: 'ready'} | {type: 'save'; environment: Environment} | {type: 'dirty'; dirty: boolean}

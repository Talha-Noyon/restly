import * as vscode from 'vscode'
import {newRequest, type Collection, type RequestDef} from '../../shared/model'
import {newId} from '../../shared/id'
import {findNode, locationLabel, type Found} from '../../shared/tree'
import {prepareRequest} from '../../shared/prepare'
import {generateCode} from '../../shared/codegen'
import {runTests} from '../../shared/assert'
import {Resolver} from '../../shared/vars'
import type {FromRequestView, ToRequestView} from '../../shared/messages'
import {sendRequest, RequestError, type HttpResult} from '../http/send'
import {decodeText, headerValue, toResponseView} from '../http/view'
import {sendOptions, userAgent} from '../config'
import {pickContainer} from '../pick'
import type {DataService} from '../store/data'
import type {HistoryStore} from '../store/history'
import {renderHtml, webviewOptions} from './html'

export interface Binding {
  collectionId: string
  requestId: string
}

class RequestEditor {
  dirty = false
  abort?: AbortController
  lastResponse?: HttpResult
  /** Name as last saved, to tell a sidebar rename from an unsaved edit. */
  savedName: string

  constructor(
    readonly panel: vscode.WebviewPanel,
    public request: RequestDef,
    public binding: Binding | null
  ) {
    this.savedName = request.name
  }

  post(message: ToRequestView) {
    void this.panel.webview.postMessage(message)
  }

  updateTitle() {
    this.panel.title = `${this.dirty ? '● ' : ''}${this.request.name || 'Untitled'}`
  }
}

/** Opens request editors, one tab per saved request, and runs what they send. */
export class RequestPanels implements vscode.Disposable {
  private readonly editors = new Set<RequestEditor>()
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly data: DataService,
    private readonly history: HistoryStore
  ) {
    this.disposables.push(data.onDidChange(() => this.syncWithData()))
  }

  openNew(request?: RequestDef): void {
    this.open(request ?? newRequest(newId()), null)
  }

  openSaved(collectionId: string, requestId: string): void {
    for (const editor of this.editors) {
      if (editor.binding?.collectionId === collectionId && editor.binding.requestId === requestId) {
        editor.panel.reveal()
        return
      }
    }
    const collection = this.data.getCollection(collectionId)
    const found = collection && findNode(collection, requestId)
    if (!found || found.node.type !== 'request') return
    this.open(structuredClone(found.node), {collectionId, requestId})
  }

  private open(request: RequestDef, binding: Binding | null): void {
    const panel = vscode.window.createWebviewPanel(
      'restly.request',
      request.name,
      vscode.ViewColumn.Active,
      webviewOptions(this.context.extensionUri)
    )
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'restly-color.svg')
    const editor = new RequestEditor(panel, request, binding)
    editor.updateTitle()
    this.editors.add(editor)
    panel.webview.html = renderHtml(panel.webview, this.context.extensionUri, 'request')
    panel.webview.onDidReceiveMessage((message: FromRequestView) => {
      this.handle(editor, message).catch((error: unknown) => {
        void vscode.window.showErrorMessage(`Restly: ${(error as Error).message}`)
      })
    })
    panel.onDidDispose(() => {
      editor.abort?.abort()
      this.editors.delete(editor)
    })
  }

  private async handle(editor: RequestEditor, message: FromRequestView): Promise<void> {
    switch (message.type) {
      case 'ready':
        editor.post({
          type: 'init',
          request: editor.request,
          location: this.locate(editor.binding)?.label ?? null,
          variables: this.variableNames(editor)
        })
        break
      case 'send':
        editor.request = message.request
        await this.send(editor, message.request)
        break
      case 'cancel':
        editor.abort?.abort()
        break
      case 'save':
        editor.request = message.request
        await this.save(editor, message.request)
        break
      case 'dirty':
        editor.dirty = message.dirty
        editor.request = message.request
        editor.updateTitle()
        break
      case 'pickFile': {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Select file'
        })
        if (picked?.[0])
          editor.post({type: 'filePicked', token: message.token, path: picked[0].fsPath})
        break
      }
      case 'codegen': {
        const {prepared} = this.prepare(editor, message.request)
        editor.post({
          type: 'code',
          target: message.target,
          code: generateCode(message.target, prepared)
        })
        break
      }
      case 'copy':
        await vscode.env.clipboard.writeText(message.text)
        void vscode.window.setStatusBarMessage('$(check) Copied to clipboard', 2000)
        break
      case 'saveResponse':
        await this.saveResponse(editor)
        break
    }
  }

  private collectionOf(editor: RequestEditor): Collection | undefined {
    return this.data.getCollection(editor.binding?.collectionId)
  }

  private prepare(editor: RequestEditor, request: RequestDef) {
    const collection = this.collectionOf(editor)
    const vars = this.data.varsFor(collection)
    return {
      vars,
      ...prepareRequest({
        request,
        collectionAuth: collection?.auth,
        vars,
        userAgent: userAgent(this.context)
      })
    }
  }

  private async send(editor: RequestEditor, request: RequestDef): Promise<void> {
    editor.abort?.abort()
    const controller = new AbortController()
    editor.abort = controller
    const isCurrent = () => editor.abort === controller

    const {prepared, unresolved, vars} = this.prepare(editor, request)
    editor.post({type: 'sending'})
    const entry = {id: newId(), timestamp: Date.now(), request: structuredClone(request)}

    try {
      const result = await sendRequest(prepared, {...sendOptions(), signal: controller.signal})
      if (!isCurrent()) return
      editor.lastResponse = result
      const view = toResponseView(result)
      const fullText =
        view.bodyKind === 'text'
          ? decodeText(result.body, headerValue(result.headers, 'content-type'))
          : ''
      const resolver = new Resolver(vars)
      const run = runTests(
        request.tests,
        {
          status: result.status,
          headers: result.headers,
          body: fullText,
          durationMs: result.durationMs
        },
        (text) => resolver.resolve(text)
      )
      if (run.setEnv.length) {
        const env = await this.data.applyEnvUpdates(run.setEnv)
        void vscode.window.setStatusBarMessage(
          `$(check) Restly set ${run.setEnv.map((u) => u.key).join(', ')} in ${env.name}`,
          4000
        )
      }
      editor.post({type: 'response', response: view, tests: run.results, unresolved})
      await this.history.add({...entry, status: result.status, durationMs: result.durationMs})
    } catch (error) {
      const err =
        error instanceof RequestError ? error : new RequestError(String(error), 'EUNKNOWN')
      if (!isCurrent()) return
      editor.post({type: 'error', message: err.message, code: err.code, unresolved})
      if (err.code !== 'ECANCELLED') await this.history.add({...entry, error: err.message})
    } finally {
      if (isCurrent()) editor.abort = undefined
    }
  }

  private async save(editor: RequestEditor, request: RequestDef): Promise<void> {
    const located = this.locate(editor.binding)
    if (located && located.found.node.type === 'request') {
      const saved: RequestDef = {...structuredClone(request), id: located.found.node.id}
      located.found.parent.children[located.found.index] = saved
      await this.data.saveCollection(located.collection)
      this.markSaved(editor, saved, located.label)
      return
    }

    const target = await pickContainer(this.data)
    if (!target) return
    const name = await vscode.window.showInputBox({
      prompt: 'Request name',
      value: request.name,
      validateInput: (v) => (v.trim() ? null : 'A name is required')
    })
    if (name === undefined) return
    const saved: RequestDef = {...structuredClone(request), id: newId(), name: name.trim()}
    target.container.children.push(saved)
    editor.binding = {collectionId: target.collection.id, requestId: saved.id}
    await this.data.saveCollection(target.collection)
    this.markSaved(
      editor,
      saved,
      locationLabel(target.collection, saved.id) ?? target.collection.name
    )
  }

  private markSaved(editor: RequestEditor, request: RequestDef, location: string) {
    editor.request = request
    editor.savedName = request.name
    editor.dirty = false
    editor.updateTitle()
    editor.post({type: 'saved', request, location})
  }

  private async saveResponse(editor: RequestEditor): Promise<void> {
    const response = editor.lastResponse
    if (!response) return
    const type = headerValue(response.headers, 'content-type').split(';')[0]
    const ext = /json/.test(type)
      ? 'json'
      : /xml/.test(type)
        ? 'xml'
        : /html/.test(type)
          ? 'html'
          : 'txt'
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri
    const uri = await vscode.window.showSaveDialog({
      defaultUri: folder ? vscode.Uri.joinPath(folder, `response.${ext}`) : undefined,
      saveLabel: 'Save response'
    })
    if (!uri) return
    await vscode.workspace.fs.writeFile(uri, response.body)
    void vscode.window.setStatusBarMessage(
      `$(check) Saved ${vscode.workspace.asRelativePath(uri)}`,
      3000
    )
  }

  private locate(
    binding: Binding | null
  ): {collection: Collection; found: Found; label: string} | null {
    if (!binding) return null
    const collection = this.data.getCollection(binding.collectionId)
    const found = collection && findNode(collection, binding.requestId)
    if (!collection || !found) return null
    return {
      collection,
      found,
      label: locationLabel(collection, binding.requestId) ?? collection.name
    }
  }

  private variableNames(editor: RequestEditor): string[] {
    return Object.keys(this.data.varsFor(this.collectionOf(editor)))
  }

  /** Follows sidebar renames, moves and deletes, and refreshes known variables. */
  private syncWithData() {
    for (const editor of this.editors) {
      if (editor.binding) {
        const located = this.locate(editor.binding)
        if (!located || located.found.node.type !== 'request') {
          editor.binding = null
          editor.post({type: 'renamed', name: editor.request.name, location: null})
        } else if (located.found.node.name !== editor.savedName) {
          editor.savedName = located.found.node.name
          editor.request = {...editor.request, name: located.found.node.name}
          editor.updateTitle()
          editor.post({type: 'renamed', name: located.found.node.name, location: located.label})
        }
      }
      editor.post({type: 'variables', names: this.variableNames(editor)})
    }
  }

  dispose(): void {
    for (const editor of this.editors) editor.panel.dispose()
    this.disposables.forEach((d) => d.dispose())
  }
}

import * as vscode from 'vscode'
import {GLOBAL_ENV_ID, type Environment} from '../../shared/model'
import type {FromEnvironmentView, ToEnvironmentView} from '../../shared/messages'
import type {DataService} from '../store/data'
import {renderHtml, webviewOptions} from './html'

class EnvironmentEditor {
  dirty = false
  /** What the webview last received, to skip echoing our own saves back. */
  snapshot = ''

  constructor(
    readonly panel: vscode.WebviewPanel,
    readonly envId: string
  ) {}

  post(message: ToEnvironmentView) {
    void this.panel.webview.postMessage(message)
  }

  updateTitle(name: string) {
    this.panel.title = `${this.dirty ? '● ' : ''}Env: ${name}`
  }
}

export class EnvironmentPanels implements vscode.Disposable {
  private readonly editors = new Map<string, EnvironmentEditor>()
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly data: DataService
  ) {
    this.disposables.push(data.onDidChange(() => this.syncWithData()))
  }

  open(envId: string): void {
    const existing = this.editors.get(envId)
    if (existing) {
      existing.panel.reveal()
      return
    }
    const env = this.data.getEnvironment(envId)
    if (!env) return
    const panel = vscode.window.createWebviewPanel(
      'restly.environment',
      `Env: ${env.name}`,
      vscode.ViewColumn.Active,
      webviewOptions(this.context.extensionUri)
    )
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'restly-color.svg')
    const editor = new EnvironmentEditor(panel, envId)
    this.editors.set(envId, editor)
    panel.webview.html = renderHtml(panel.webview, this.context.extensionUri, 'environment')
    panel.webview.onDidReceiveMessage((message: FromEnvironmentView) => {
      this.handle(editor, message).catch((error: unknown) => {
        void vscode.window.showErrorMessage(`Restly: ${(error as Error).message}`)
      })
    })
    panel.onDidDispose(() => this.editors.delete(envId))
  }

  private sendInit(editor: EnvironmentEditor, env: Environment) {
    editor.snapshot = JSON.stringify(env)
    editor.post({
      type: 'init',
      environment: structuredClone(env),
      isGlobal: env.id === GLOBAL_ENV_ID
    })
    editor.updateTitle(env.name)
  }

  private async handle(editor: EnvironmentEditor, message: FromEnvironmentView): Promise<void> {
    const env = this.data.getEnvironment(editor.envId)
    switch (message.type) {
      case 'ready':
        if (env) this.sendInit(editor, env)
        break
      case 'dirty':
        editor.dirty = message.dirty
        editor.updateTitle(env?.name ?? '')
        break
      case 'save': {
        const next: Environment = {
          ...message.environment,
          id: editor.envId,
          name:
            editor.envId === GLOBAL_ENV_ID
              ? 'Global'
              : message.environment.name.trim() || 'Environment',
          variables: message.environment.variables.filter((v) => v.key.trim() || v.value)
        }
        await this.data.saveEnvironment(next)
        editor.dirty = false
        editor.snapshot = JSON.stringify(next)
        editor.updateTitle(next.name)
        editor.post({type: 'saved', environment: next})
        break
      }
    }
  }

  private syncWithData() {
    for (const editor of this.editors.values()) {
      const env = this.data.getEnvironment(editor.envId)
      if (!env) {
        editor.panel.dispose()
        continue
      }
      // Values captured by tests, or a `git pull`, reach an editor with no unsaved edits.
      if (!editor.dirty && JSON.stringify(env) !== editor.snapshot) this.sendInit(editor, env)
    }
  }

  dispose(): void {
    for (const editor of this.editors.values()) editor.panel.dispose()
    this.disposables.forEach((d) => d.dispose())
  }
}

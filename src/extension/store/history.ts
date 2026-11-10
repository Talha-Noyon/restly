import * as vscode from 'vscode'
import type {HistoryEntry} from '../../shared/model'
import {normalizeRequest} from '../../shared/normalize'

/** Sent requests, newest first. Always global: it is personal and never committed. */
export class HistoryStore implements vscode.Disposable {
  entries: HistoryEntry[] = []
  private readonly file: vscode.Uri
  private writing: Promise<void> = Promise.resolve()
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.emitter.event

  constructor(private readonly context: vscode.ExtensionContext) {
    this.file = vscode.Uri.joinPath(context.globalStorageUri, 'history.json')
  }

  async load(): Promise<void> {
    try {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(this.file))
      const raw: unknown = JSON.parse(text)
      this.entries = Array.isArray(raw)
        ? raw
            .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
            .map((e) => ({
              id: String(e.id ?? ''),
              timestamp: Number(e.timestamp) || 0,
              request: normalizeRequest(e.request),
              status: typeof e.status === 'number' ? e.status : undefined,
              durationMs: typeof e.durationMs === 'number' ? e.durationMs : undefined,
              error: typeof e.error === 'string' ? e.error : undefined
            }))
        : []
    } catch {
      this.entries = []
    }
    this.emitter.fire()
  }

  get(id: string): HistoryEntry | undefined {
    return this.entries.find((e) => e.id === id)
  }

  async add(entry: HistoryEntry): Promise<void> {
    const limit = vscode.workspace.getConfiguration('restly').get<number>('historyLimit', 500)
    this.entries.unshift(entry)
    this.entries.length = Math.min(this.entries.length, Math.max(0, limit))
    await this.persist()
  }

  async remove(id: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.id !== id)
    await this.persist()
  }

  async clear(): Promise<void> {
    this.entries = []
    await this.persist()
  }

  private persist(): Promise<void> {
    this.emitter.fire()
    const snapshot = JSON.stringify(this.entries)
    // Serialise writes so a slow one never lands after a newer one.
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await vscode.workspace.fs.createDirectory(this.context.globalStorageUri)
        await vscode.workspace.fs.writeFile(this.file, new TextEncoder().encode(snapshot))
      })
    return this.writing.catch(() => undefined)
  }

  dispose(): void {
    this.emitter.dispose()
  }
}

import * as vscode from 'vscode'
import {newId} from '../../shared/id'
import {slugify} from '../../shared/format'

export interface Named {
  id: string
  name: string
}

/**
 * A folder of JSON files, one item per file, named after the item so diffs and
 * merges stay readable. Files that fail to parse are reported and left alone:
 * they are never in the id map, so they are never overwritten.
 */
export class JsonDir<T extends Named> {
  private uris = new Map<string, vscode.Uri>()
  private files = new Set<string>()
  private warned = new Set<string>()

  constructor(
    readonly dir: vscode.Uri,
    private readonly parse: (value: unknown) => T | null
  ) {}

  async list(): Promise<T[]> {
    let entries: [string, vscode.FileType][]
    try {
      entries = await vscode.workspace.fs.readDirectory(this.dir)
    } catch {
      this.uris.clear()
      this.files.clear()
      return []
    }

    const items: T[] = []
    const uris = new Map<string, vscode.Uri>()
    this.files = new Set(entries.map(([name]) => name.toLowerCase()))
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.toLowerCase().endsWith('.json')) continue
      const uri = vscode.Uri.joinPath(this.dir, name)
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
        const item = this.parse(JSON.parse(text))
        if (!item) {
          this.warn(uri, 'it is not a Restly file')
          continue
        }
        // A file copied by hand keeps its twin's id; give the copy its own.
        if (uris.has(item.id)) item.id = newId()
        uris.set(item.id, uri)
        items.push(item)
      } catch (error) {
        this.warn(uri, (error as Error).message)
      }
    }
    this.uris = uris
    return items.sort((a, b) => a.name.localeCompare(b.name))
  }

  async save(item: T): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.dir)
    const existing = this.uris.get(item.id)
    const target = this.targetFor(item, existing)
    const text = `${JSON.stringify(item, null, 2)}\n`
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text))
    this.files.add(fileName(target).toLowerCase())
    if (existing && existing.toString() !== target.toString()) {
      await vscode.workspace.fs.delete(existing).then(undefined, () => undefined)
      this.files.delete(fileName(existing).toLowerCase())
    }
    this.uris.set(item.id, target)
  }

  async delete(id: string): Promise<void> {
    const uri = this.uris.get(id)
    if (!uri) return
    await vscode.workspace.fs.delete(uri).then(undefined, () => undefined)
    this.uris.delete(id)
    this.files.delete(fileName(uri).toLowerCase())
  }

  private targetFor(item: T, existing: vscode.Uri | undefined): vscode.Uri {
    const slug = slugify(item.name)
    if (existing) {
      const current = fileName(existing).toLowerCase()
      if (current === `${slug}.json` || new RegExp(`^${slug}-\\d+\\.json$`).test(current)) {
        return existing
      }
    }
    let candidate = `${slug}.json`
    for (let n = 2; this.files.has(candidate); n++) candidate = `${slug}-${n}.json`
    return vscode.Uri.joinPath(this.dir, candidate)
  }

  private warn(uri: vscode.Uri, reason: string) {
    const key = uri.toString()
    if (this.warned.has(key)) return
    this.warned.add(key)
    void vscode.window.showWarningMessage(
      `Restly skipped ${vscode.workspace.asRelativePath(uri)}: ${reason}`
    )
  }
}

function fileName(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? ''
}

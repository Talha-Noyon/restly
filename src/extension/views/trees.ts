import * as vscode from 'vscode'
import {GLOBAL_ENV_ID, type CollectionNode, type HttpMethod} from '../../shared/model'
import {findNode} from '../../shared/tree'
import {formatDuration, timeAgo} from '../../shared/format'
import type {DataService} from '../store/data'
import type {HistoryStore} from '../store/history'

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'charts.green',
  POST: 'charts.yellow',
  PUT: 'charts.blue',
  PATCH: 'charts.purple',
  DELETE: 'charts.red',
  HEAD: 'charts.foreground',
  OPTIONS: 'charts.foreground'
}

export function methodIcon(method: HttpMethod): vscode.ThemeIcon {
  return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(METHOD_COLORS[method]))
}

// ---- collections ---------------------------------------------------------

export type CollectionItem =
  | {kind: 'collection'; collectionId: string}
  | {kind: 'folder'; collectionId: string; id: string}
  | {kind: 'request'; collectionId: string; id: string}

export class CollectionsTree implements vscode.TreeDataProvider<CollectionItem> {
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  constructor(private readonly data: DataService) {
    data.onDidChange(() => this.emitter.fire())
  }

  getChildren(item?: CollectionItem): CollectionItem[] {
    if (!item) return this.data.collections.map((c) => ({kind: 'collection', collectionId: c.id}))
    const collection = this.data.getCollection(item.collectionId)
    if (!collection) return []
    let children: CollectionNode[] = []
    if (item.kind === 'collection') children = collection.children
    else if (item.kind === 'folder') {
      const found = findNode(collection, item.id)
      if (found?.node.type === 'folder') children = found.node.children
    }
    return children.map((node) => ({
      kind: node.type === 'folder' ? 'folder' : 'request',
      collectionId: collection.id,
      id: node.id
    }))
  }

  getTreeItem(item: CollectionItem): vscode.TreeItem {
    const collection = this.data.getCollection(item.collectionId)
    if (item.kind === 'collection') {
      const tree = new vscode.TreeItem(
        collection?.name ?? '(missing)',
        vscode.TreeItemCollapsibleState.Collapsed
      )
      tree.id = `c:${item.collectionId}`
      tree.contextValue = 'collection'
      tree.iconPath = new vscode.ThemeIcon('library')
      return tree
    }
    const node = collection && findNode(collection, item.id)?.node
    if (!node) return new vscode.TreeItem('(missing)')
    if (node.type === 'folder') {
      const tree = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed)
      tree.id = `f:${item.collectionId}:${node.id}`
      tree.contextValue = 'folder'
      tree.iconPath = vscode.ThemeIcon.Folder
      return tree
    }
    const tree = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None)
    tree.id = `r:${item.collectionId}:${node.id}`
    tree.contextValue = 'request'
    tree.description = node.method
    tree.tooltip = `${node.method} ${node.url}`
    // Without this, screen readers announce the tooltip instead of the name.
    tree.accessibilityInformation = {label: `${node.name}, ${node.method} request`}
    tree.iconPath = methodIcon(node.method)
    tree.command = {command: 'restly.openRequest', title: 'Open', arguments: [item]}
    return tree
  }
}

// ---- history -------------------------------------------------------------

export interface HistoryItem {
  kind: 'history'
  id: string
}

export class HistoryTree implements vscode.TreeDataProvider<HistoryItem> {
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  constructor(private readonly history: HistoryStore) {
    history.onDidChange(() => this.emitter.fire())
  }

  getChildren(item?: HistoryItem): HistoryItem[] {
    return item ? [] : this.history.entries.map((e) => ({kind: 'history', id: e.id}))
  }

  getTreeItem(item: HistoryItem): vscode.TreeItem {
    const entry = this.history.get(item.id)
    if (!entry) return new vscode.TreeItem('(missing)')
    const {request} = entry
    const label = request.url.replace(/^https?:\/\//i, '') || request.name
    const tree = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None)
    tree.id = `h:${entry.id}`
    tree.contextValue = 'historyEntry'
    tree.iconPath = entry.error
      ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
      : methodIcon(request.method)
    const result = entry.error ? 'failed' : `${entry.status}`
    tree.description = `${request.method} · ${result} · ${timeAgo(entry.timestamp)}`
    tree.accessibilityInformation = {
      label: `${request.method} ${label}, ${entry.error ? 'failed' : `status ${entry.status}`}`
    }
    tree.tooltip = new vscode.MarkdownString(
      [
        `**${request.method}** ${request.url}`,
        entry.error
          ? `Error: ${entry.error}`
          : `Status ${entry.status} in ${formatDuration(entry.durationMs ?? 0)}`,
        new Date(entry.timestamp).toLocaleString()
      ].join('\n\n')
    )
    tree.command = {command: 'restly.openHistoryEntry', title: 'Open', arguments: [item]}
    return tree
  }
}

// ---- environments --------------------------------------------------------

export interface EnvironmentItem {
  kind: 'environment'
  id: string
}

export class EnvironmentsTree implements vscode.TreeDataProvider<EnvironmentItem> {
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  constructor(private readonly data: DataService) {
    data.onDidChange(() => this.emitter.fire())
  }

  getChildren(item?: EnvironmentItem): EnvironmentItem[] {
    return item ? [] : this.data.environments.map((e) => ({kind: 'environment', id: e.id}))
  }

  getTreeItem(item: EnvironmentItem): vscode.TreeItem {
    const env = this.data.getEnvironment(item.id)
    if (!env) return new vscode.TreeItem('(missing)')
    const tree = new vscode.TreeItem(env.name, vscode.TreeItemCollapsibleState.None)
    tree.id = `e:${env.id}`
    const count = env.variables.filter((v) => v.key).length
    if (env.id === GLOBAL_ENV_ID) {
      tree.contextValue = 'environmentGlobal'
      tree.iconPath = new vscode.ThemeIcon('globe')
      tree.description = `always applied · ${count} vars`
    } else if (env.id === this.data.activeEnvironmentId) {
      tree.contextValue = 'environmentActive'
      tree.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'))
      tree.description = `active · ${count} vars`
    } else {
      tree.contextValue = 'environment'
      tree.iconPath = new vscode.ThemeIcon('circle-large-outline')
      tree.description = `${count} vars`
    }
    tree.command = {command: 'restly.openEnvironment', title: 'Open', arguments: [item]}
    return tree
  }
}

import * as vscode from 'vscode'
import {GLOBAL_ENV_ID, newEnvironment, newRequest, type Folder} from '../shared/model'
import {newId} from '../shared/id'
import {allRequests, cloneWithNewIds, findContainer, findNode, removeNode} from '../shared/tree'
import {CurlParseError, isCurlCommand, parseCurl} from '../shared/curl'
import {importJson} from '../shared/postman'
import {prepareRequest} from '../shared/prepare'
import {toCurl} from '../shared/codegen'
import {slugify} from '../shared/format'
import {userAgent} from './config'
import {askName, createCollection} from './pick'
import type {DataService} from './store/data'
import type {HistoryStore} from './store/history'
import type {RequestPanels} from './panels/requestPanel'
import type {EnvironmentPanels} from './panels/environmentPanel'
import type {CollectionItem, EnvironmentItem, HistoryItem} from './views/trees'

interface Deps {
  context: vscode.ExtensionContext
  data: DataService
  history: HistoryStore
  requests: RequestPanels
  environments: EnvironmentPanels
}

type TreeArg = CollectionItem | EnvironmentItem | undefined

async function confirm(message: string, action: string): Promise<boolean> {
  const answer = await vscode.window.showWarningMessage(message, {modal: true}, action)
  return answer === action
}

async function readJsonFile(uri: vscode.Uri): Promise<unknown> {
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${vscode.workspace.asRelativePath(uri)} is not valid JSON`)
  }
}

export function registerCommands({context, data, history, requests, environments}: Deps): void {
  const register = (id: string, fn: (...args: never[]) => unknown) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: never[]) => {
        try {
          await fn(...args)
        } catch (error) {
          const message =
            error instanceof CurlParseError ? `cURL: ${error.message}` : (error as Error).message
          void vscode.window.showErrorMessage(`Restly: ${message}`)
        }
      })
    )
  }

  const importData = async (json: unknown) => {
    const result = importJson(json)
    if (result.kind === 'collection') {
      await data.saveCollection(result.collection)
      const count = allRequests(result.collection).length
      void vscode.window.showInformationMessage(
        `Imported collection "${result.collection.name}" with ${count} request${count === 1 ? '' : 's'}.`
      )
    } else {
      await data.saveEnvironment(result.environment)
      void vscode.window.showInformationMessage(
        `Imported environment "${result.environment.name}".`
      )
    }
  }

  const pickJsonFile = async (title: string) => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {JSON: ['json'], 'All files': ['*']},
      title
    })
    return picked?.[0]
  }

  // ---- requests & collections --------------------------------------------

  register('restly.newRequest', async (item?: CollectionItem) => {
    if (!item || item.kind === 'request') {
      requests.openNew()
      return
    }
    const collection = data.getCollection(item.collectionId)
    const container =
      collection && findContainer(collection, item.kind === 'collection' ? collection.id : item.id)
    if (!collection || !container) return
    const request = newRequest(newId())
    container.children.push(request)
    await data.saveCollection(collection)
    requests.openSaved(collection.id, request.id)
  })

  register('restly.newCollection', () => createCollection(data))

  register('restly.newFolder', async (item?: CollectionItem) => {
    if (!item || item.kind === 'request') return
    const collection = data.getCollection(item.collectionId)
    const container =
      collection && findContainer(collection, item.kind === 'collection' ? collection.id : item.id)
    if (!collection || !container) return
    const name = await askName('Folder name', 'New Folder')
    if (!name) return
    const folder: Folder = {type: 'folder', id: newId(), name, children: []}
    container.children.push(folder)
    await data.saveCollection(collection)
  })

  register('restly.rename', async (item: TreeArg) => {
    if (!item) return
    if (item.kind === 'environment') {
      const env = data.getEnvironment(item.id)
      if (!env || env.id === GLOBAL_ENV_ID) return
      const name = await askName('Environment name', env.name)
      if (name) await data.saveEnvironment({...env, name})
      return
    }
    const collection = data.getCollection(item.collectionId)
    if (!collection) return
    if (item.kind === 'collection') {
      const name = await askName('Collection name', collection.name)
      if (name) await data.saveCollection({...collection, name})
      return
    }
    const found = findNode(collection, item.id)
    if (!found) return
    const name = await askName(
      found.node.type === 'folder' ? 'Folder name' : 'Request name',
      found.node.name
    )
    if (!name) return
    found.node.name = name
    await data.saveCollection(collection)
  })

  register('restly.delete', async (item: TreeArg) => {
    if (!item) return
    if (item.kind === 'environment') {
      const env = data.getEnvironment(item.id)
      if (!env || env.id === GLOBAL_ENV_ID) return
      if (await confirm(`Delete environment "${env.name}"?`, 'Delete'))
        await data.deleteEnvironment(env.id)
      return
    }
    const collection = data.getCollection(item.collectionId)
    if (!collection) return
    if (item.kind === 'collection') {
      const count = allRequests(collection).length
      const ok = await confirm(
        `Delete collection "${collection.name}" and its ${count} request${count === 1 ? '' : 's'}?`,
        'Delete'
      )
      if (ok) await data.deleteCollection(collection.id)
      return
    }
    const found = findNode(collection, item.id)
    if (!found) return
    const what = found.node.type === 'folder' ? 'folder' : 'request'
    if (!(await confirm(`Delete ${what} "${found.node.name}"?`, 'Delete'))) return
    removeNode(collection, item.id)
    await data.saveCollection(collection)
  })

  register('restly.duplicate', async (item: TreeArg) => {
    if (!item) return
    if (item.kind === 'environment') {
      const env = data.getEnvironment(item.id)
      if (!env || env.id === GLOBAL_ENV_ID) return
      await data.saveEnvironment({...structuredClone(env), id: newId(), name: `${env.name} copy`})
      return
    }
    const collection = data.getCollection(item.collectionId)
    if (!collection) return
    if (item.kind === 'collection') {
      const copy = structuredClone(collection)
      copy.id = newId()
      copy.name = `${collection.name} copy`
      copy.children = copy.children.map((n) => cloneWithNewIds(n))
      await data.saveCollection(copy)
      return
    }
    const found = findNode(collection, item.id)
    if (!found) return
    const copy = cloneWithNewIds(found.node)
    copy.name = `${found.node.name} copy`
    found.parent.children.splice(found.index + 1, 0, copy)
    await data.saveCollection(collection)
  })

  register('restly.import', async () => {
    const choice = await vscode.window.showQuickPick(
      [
        {label: '$(terminal) Paste a cURL command', id: 'curl'},
        {label: '$(clippy) From clipboard', description: 'cURL command or JSON', id: 'clipboard'},
        {label: '$(file) From file…', description: 'Postman v2.x or Restly JSON', id: 'file'}
      ],
      {placeHolder: 'Import into Restly'}
    )
    if (!choice) return
    if (choice.id === 'curl') {
      const command = await vscode.window.showInputBox({
        prompt: 'Paste a cURL command',
        placeHolder:
          "curl -X POST 'https://api.example.com' -H 'Content-Type: application/json' -d '{}'"
      })
      if (command?.trim()) requests.openNew(parseCurl(command))
    } else if (choice.id === 'clipboard') {
      const text = (await vscode.env.clipboard.readText()).trim()
      if (!text) throw new Error('The clipboard is empty')
      if (isCurlCommand(text)) {
        requests.openNew(parseCurl(text))
        return
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error('The clipboard holds neither a cURL command nor JSON')
      }
      await importData(json)
    } else {
      const uri = await pickJsonFile('Import Postman or Restly file')
      if (uri) await importData(await readJsonFile(uri))
    }
  })

  register('restly.exportCollection', async (item?: CollectionItem) => {
    const collection = item && data.getCollection(item.collectionId)
    if (!collection) return
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri
    const uri = await vscode.window.showSaveDialog({
      defaultUri: folder
        ? vscode.Uri.joinPath(folder, `${slugify(collection.name)}.restly.json`)
        : undefined,
      filters: {JSON: ['json']},
      saveLabel: 'Export collection'
    })
    if (!uri) return
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(`${JSON.stringify(collection, null, 2)}\n`)
    )
    void vscode.window.showInformationMessage(`Exported "${collection.name}".`)
  })

  register('restly.copyAsCurl', async (item?: CollectionItem) => {
    if (item?.kind !== 'request') return
    const collection = data.getCollection(item.collectionId)
    const found = collection && findNode(collection, item.id)
    if (!collection || found?.node.type !== 'request') return
    const {prepared, unresolved} = prepareRequest({
      request: found.node,
      collectionAuth: collection.auth,
      vars: data.varsFor(collection),
      userAgent: userAgent(context)
    })
    await vscode.env.clipboard.writeText(toCurl(prepared))
    const note = unresolved.length ? ` (unresolved: ${unresolved.join(', ')})` : ''
    void vscode.window.setStatusBarMessage(`$(check) Copied cURL${note}`, 3000)
  })

  register('restly.refresh', () => data.reload())

  register('restly.openRequest', (item?: CollectionItem) => {
    if (item?.kind === 'request') requests.openSaved(item.collectionId, item.id)
  })

  // ---- history -----------------------------------------------------------

  register('restly.openHistoryEntry', (item?: HistoryItem) => {
    const entry = item && history.get(item.id)
    if (entry) requests.openNew({...structuredClone(entry.request), id: newId()})
  })

  register('restly.deleteHistoryEntry', (item?: HistoryItem) =>
    item ? history.remove(item.id) : undefined
  )

  register('restly.clearHistory', async () => {
    if (history.entries.length && (await confirm('Clear all request history?', 'Clear'))) {
      await history.clear()
    }
  })

  // ---- environments ------------------------------------------------------

  register('restly.newEnvironment', async () => {
    const name = await askName('Environment name', 'Development')
    if (!name) return
    const env = newEnvironment(newId(), name)
    await data.saveEnvironment(env)
    if (!data.activeEnvironmentId) await data.setActiveEnvironment(env.id)
    environments.open(env.id)
  })

  register('restly.importEnvironment', async () => {
    const uri = await pickJsonFile('Import Postman or Restly environment')
    if (uri) await importData(await readJsonFile(uri))
  })

  register('restly.setActiveEnvironment', (item?: EnvironmentItem) =>
    item && item.id !== GLOBAL_ENV_ID ? data.setActiveEnvironment(item.id) : undefined
  )

  register('restly.selectEnvironment', async () => {
    const active = data.activeEnvironmentId
    const items = [
      {label: '$(circle-slash) No environment', id: undefined as string | undefined},
      ...data.environments
        .filter((e) => e.id !== GLOBAL_ENV_ID)
        .map((e) => ({
          label: `${e.id === active ? '$(pass-filled)' : '$(circle-large-outline)'} ${e.name}`,
          description: `${e.variables.length} vars`,
          id: e.id as string | undefined
        }))
    ]
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select the active environment'
    })
    if (picked) await data.setActiveEnvironment(picked.id)
  })

  register('restly.openEnvironment', (item?: EnvironmentItem) => {
    if (item) environments.open(item.id)
  })
}

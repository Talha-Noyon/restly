import * as vscode from 'vscode'
import {newCollection, type Collection} from '../shared/model'
import {newId} from '../shared/id'
import {findContainer, listContainers, type Container} from '../shared/tree'
import type {DataService} from './store/data'

export async function askName(prompt: string, value = ''): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    prompt,
    value,
    validateInput: (v) => (v.trim() ? null : 'A name is required')
  })
  return name?.trim()
}

export async function createCollection(data: DataService): Promise<Collection | undefined> {
  const name = await askName('Collection name', 'My Collection')
  if (!name) return undefined
  const collection = newCollection(newId(), name)
  await data.saveCollection(collection)
  return collection
}

/** Asks where to save a request: any collection or folder, or a new collection. */
export async function pickContainer(
  data: DataService
): Promise<{collection: Collection; container: Container} | undefined> {
  type Item = vscode.QuickPickItem & {collectionId?: string; containerId?: string}
  const items: Item[] = []
  for (const collection of data.collections) {
    for (const choice of listContainers(collection)) {
      items.push({
        label: `$(${choice.id === collection.id ? 'library' : 'folder'}) ${choice.label}`,
        collectionId: collection.id,
        containerId: choice.id
      })
    }
  }
  items.push({label: '$(add) New collection…'})

  const picked =
    items.length === 1
      ? items[0]
      : await vscode.window.showQuickPick(items, {
          placeHolder: 'Save request to…'
        })
  if (!picked) return undefined
  if (!picked.collectionId) {
    const collection = await createCollection(data)
    return collection ? {collection, container: collection} : undefined
  }
  const collection = data.getCollection(picked.collectionId)
  const container = collection && findContainer(collection, picked.containerId!)
  return collection && container ? {collection, container} : undefined
}

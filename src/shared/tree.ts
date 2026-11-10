import type {Collection, CollectionNode, Folder, RequestDef} from './model'
import {newId} from './id'

export type Container = Collection | Folder

export interface Found {
  node: CollectionNode
  parent: Container
  index: number
}

export function findNode(container: Container, id: string): Found | null {
  for (let index = 0; index < container.children.length; index++) {
    const node = container.children[index]
    if (node.id === id) return {node, parent: container, index}
    if (node.type === 'folder') {
      const inner = findNode(node, id)
      if (inner) return inner
    }
  }
  return null
}

/** The collection itself when `id` is its id, else the folder with that id. */
export function findContainer(collection: Collection, id: string): Container | null {
  if (collection.id === id) return collection
  const found = findNode(collection, id)
  return found?.node.type === 'folder' ? found.node : null
}

export function removeNode(collection: Collection, id: string): CollectionNode | null {
  const found = findNode(collection, id)
  if (!found) return null
  found.parent.children.splice(found.index, 1)
  return found.node
}

/** Deep copy with fresh ids, so a duplicate never collides with its original. */
export function cloneWithNewIds<T extends CollectionNode>(node: T): T {
  const copy = structuredClone(node)
  const reassign = (n: CollectionNode) => {
    n.id = newId()
    if (n.type === 'folder') n.children.forEach(reassign)
  }
  reassign(copy)
  return copy
}

export interface ContainerChoice {
  id: string
  label: string
}

/** Every place a request can be saved into, labelled `Collection / Folder / Sub`. */
export function listContainers(collection: Collection): ContainerChoice[] {
  const out: ContainerChoice[] = [{id: collection.id, label: collection.name}]
  const walk = (children: CollectionNode[], prefix: string) => {
    for (const node of children) {
      if (node.type !== 'folder') continue
      const label = `${prefix} / ${node.name}`
      out.push({id: node.id, label})
      walk(node.children, label)
    }
  }
  walk(collection.children, collection.name)
  return out
}

/** "Collection / Folder / Sub" for the container holding node `id`, or null. */
export function locationLabel(collection: Collection, id: string): string | null {
  const walk = (children: CollectionNode[], trail: string[]): string[] | null => {
    for (const node of children) {
      if (node.id === id) return trail
      if (node.type === 'folder') {
        const inner = walk(node.children, [...trail, node.name])
        if (inner) return inner
      }
    }
    return null
  }
  const trail = walk(collection.children, [collection.name])
  return trail ? trail.join(' / ') : null
}

export function allRequests(container: Container): RequestDef[] {
  const out: RequestDef[] = []
  for (const node of container.children) {
    if (node.type === 'request') out.push(node)
    else out.push(...allRequests(node))
  }
  return out
}

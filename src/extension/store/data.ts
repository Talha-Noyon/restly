import * as vscode from 'vscode'
import {
  GLOBAL_ENV_ID,
  newEnvironment,
  type Collection,
  type Environment,
  type EnvVariable
} from '../../shared/model'
import {normalizeCollection, normalizeEnvironment} from '../../shared/normalize'
import {mergeVars, type Vars} from '../../shared/vars'
import {JsonDir} from './jsonDir'

const ACTIVE_ENV_KEY = 'restly.activeEnvironment'

export type StorageMode = 'workspace' | 'global'

/**
 * Collections and environments, loaded into memory and written back on every
 * change. Secret environment values are kept in SecretStorage; the JSON on disk
 * only ever holds their names.
 */
export class DataService implements vscode.Disposable {
  collections: Collection[] = []
  environments: Environment[] = []
  mode: StorageMode = 'workspace'
  baseUri!: vscode.Uri

  private collectionsDir!: JsonDir<Collection>
  private environmentsDir!: JsonDir<Environment>
  private watcher?: vscode.FileSystemWatcher
  private reloadTimer?: NodeJS.Timeout
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.emitter.event

  constructor(private readonly context: vscode.ExtensionContext) {}

  async init(): Promise<void> {
    this.configure()
    await this.reload()
  }

  /** Picks the storage folder from settings; call again when they change. */
  configure(): void {
    const setting = vscode.workspace.getConfiguration('restly').get<StorageMode>('storage')
    const folder = vscode.workspace.workspaceFolders?.[0]
    this.mode = setting === 'global' || !folder ? 'global' : 'workspace'
    this.baseUri =
      this.mode === 'workspace'
        ? vscode.Uri.joinPath(folder!.uri, '.restly')
        : this.context.globalStorageUri
    this.collectionsDir = new JsonDir(
      vscode.Uri.joinPath(this.baseUri, 'collections'),
      normalizeCollection
    )
    this.environmentsDir = new JsonDir(
      vscode.Uri.joinPath(this.baseUri, 'environments'),
      normalizeEnvironment
    )

    this.watcher?.dispose()
    this.watcher = undefined
    if (this.mode === 'workspace') {
      // Picks up `git pull`, branch switches and hand edits.
      this.watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder!, '.restly/**/*.json')
      )
      const schedule = () => this.scheduleReload()
      this.watcher.onDidCreate(schedule)
      this.watcher.onDidChange(schedule)
      this.watcher.onDidDelete(schedule)
    }
  }

  private scheduleReload() {
    clearTimeout(this.reloadTimer)
    this.reloadTimer = setTimeout(() => void this.reload(), 300)
  }

  async reload(): Promise<void> {
    const [collections, environments] = await Promise.all([
      this.collectionsDir.list(),
      this.environmentsDir.list()
    ])
    for (const env of environments) await this.loadSecrets(env)
    if (!environments.some((e) => e.id === GLOBAL_ENV_ID)) {
      environments.unshift(newEnvironment(GLOBAL_ENV_ID, 'Global'))
    }
    this.collections = collections
    this.environments = environments
    this.emitter.fire()
  }

  // ---- collections ------------------------------------------------------

  getCollection(id: string | undefined): Collection | undefined {
    return id ? this.collections.find((c) => c.id === id) : undefined
  }

  async saveCollection(collection: Collection): Promise<void> {
    await this.collectionsDir.save(collection)
    const index = this.collections.findIndex((c) => c.id === collection.id)
    if (index >= 0) this.collections[index] = collection
    else this.collections.push(collection)
    this.collections.sort((a, b) => a.name.localeCompare(b.name))
    this.emitter.fire()
  }

  async deleteCollection(id: string): Promise<void> {
    await this.collectionsDir.delete(id)
    this.collections = this.collections.filter((c) => c.id !== id)
    this.emitter.fire()
  }

  // ---- environments -----------------------------------------------------

  get globalEnvironment(): Environment {
    return this.environments.find((e) => e.id === GLOBAL_ENV_ID)!
  }

  get activeEnvironmentId(): string | undefined {
    const id = this.context.workspaceState.get<string>(ACTIVE_ENV_KEY)
    return id && this.environments.some((e) => e.id === id && e.id !== GLOBAL_ENV_ID)
      ? id
      : undefined
  }

  get activeEnvironment(): Environment | undefined {
    const id = this.activeEnvironmentId
    return id ? this.getEnvironment(id) : undefined
  }

  async setActiveEnvironment(id: string | undefined): Promise<void> {
    await this.context.workspaceState.update(ACTIVE_ENV_KEY, id)
    this.emitter.fire()
  }

  getEnvironment(id: string): Environment | undefined {
    return this.environments.find((e) => e.id === id)
  }

  async saveEnvironment(env: Environment): Promise<void> {
    const previous = this.getEnvironment(env.id)
    const secrets = this.context.secrets
    const keep = new Set(env.variables.filter((v) => v.secret && v.key).map((v) => v.key))
    for (const v of previous?.variables ?? []) {
      if (v.secret && !keep.has(v.key)) await secrets.delete(secretKey(env.id, v.key))
    }
    for (const v of env.variables) {
      if (v.secret && v.key) await secrets.store(secretKey(env.id, v.key), v.value)
    }

    const onDisk: Environment = {
      ...env,
      variables: env.variables.map((v): EnvVariable => (v.secret ? {...v, value: ''} : v))
    }
    await this.environmentsDir.save(onDisk)

    const index = this.environments.findIndex((e) => e.id === env.id)
    const copy = structuredClone(env)
    if (index >= 0) this.environments[index] = copy
    else this.environments.push(copy)
    this.sortEnvironments()
    this.emitter.fire()
  }

  async deleteEnvironment(id: string): Promise<void> {
    if (id === GLOBAL_ENV_ID) return
    const env = this.getEnvironment(id)
    for (const v of env?.variables ?? []) {
      if (v.secret) await this.context.secrets.delete(secretKey(id, v.key))
    }
    await this.environmentsDir.delete(id)
    this.environments = this.environments.filter((e) => e.id !== id)
    if (this.context.workspaceState.get(ACTIVE_ENV_KEY) === id) {
      await this.context.workspaceState.update(ACTIVE_ENV_KEY, undefined)
    }
    this.emitter.fire()
  }

  /** Writes values captured by `setEnv` tests into the active environment, else Global. */
  async applyEnvUpdates(updates: {key: string; value: string}[]): Promise<Environment> {
    const target = structuredClone(this.activeEnvironment ?? this.globalEnvironment)
    for (const {key, value} of updates) {
      const existing = target.variables.find((v) => v.key === key)
      if (existing) existing.value = value
      else target.variables.push({key, value, enabled: true, secret: false})
    }
    await this.saveEnvironment(target)
    return target
  }

  /** Variable lookup: active environment, then the collection, then Global. */
  varsFor(collection?: Collection): Vars {
    return mergeVars(
      this.activeEnvironment?.variables ?? [],
      collection?.variables ?? [],
      this.globalEnvironment.variables
    )
  }

  private sortEnvironments() {
    this.environments.sort((a, b) =>
      a.id === GLOBAL_ENV_ID ? -1 : b.id === GLOBAL_ENV_ID ? 1 : a.name.localeCompare(b.name)
    )
  }

  private async loadSecrets(env: Environment) {
    for (const v of env.variables) {
      if (v.secret && v.key)
        v.value = (await this.context.secrets.get(secretKey(env.id, v.key))) ?? ''
    }
  }

  dispose(): void {
    clearTimeout(this.reloadTimer)
    this.watcher?.dispose()
    this.emitter.dispose()
  }
}

function secretKey(envId: string, key: string): string {
  return `restly.env.${envId}.${key}`
}

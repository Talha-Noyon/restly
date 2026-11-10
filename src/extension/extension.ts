import * as vscode from 'vscode'
import {DataService} from './store/data'
import {HistoryStore} from './store/history'
import {RequestPanels} from './panels/requestPanel'
import {EnvironmentPanels} from './panels/environmentPanel'
import {CollectionsTree, EnvironmentsTree, HistoryTree} from './views/trees'
import {registerCommands} from './commands'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const data = new DataService(context)
  const history = new HistoryStore(context)
  const requests = new RequestPanels(context, data, history)
  const environments = new EnvironmentPanels(context, data)
  context.subscriptions.push(data, history, requests, environments)

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('restly.collections', new CollectionsTree(data)),
    vscode.window.registerTreeDataProvider('restly.history', new HistoryTree(history)),
    vscode.window.registerTreeDataProvider('restly.environments', new EnvironmentsTree(data))
  )
  registerCommands({context, data, history, requests, environments})

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  status.command = 'restly.selectEnvironment'
  const updateStatus = () => {
    const env = data.activeEnvironment
    status.text = `$(globe) ${env ? env.name : 'No Environment'}`
    status.tooltip = 'Restly: select the active environment'
    status.show()
  }
  context.subscriptions.push(status, data.onDidChange(updateStatus))

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('restly.storage')) {
        data.configure()
        void data.reload()
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      data.configure()
      void data.reload()
    })
  )

  await Promise.all([data.init(), history.load()])
  updateStatus()
}

export function deactivate(): void {}

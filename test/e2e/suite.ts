// Runs inside a real VS Code (see scripts/e2e.mjs) against test/e2e/fixture.
import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'

const tabLabels = () =>
  vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => tab.label))

async function waitFor(check: () => boolean, what: string) {
  for (let i = 0; i < 50; i++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${what}; tabs: ${tabLabels().join(', ')}`)
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.all.find(
    (e) => (e.packageJSON as {name?: string}).name === 'restly'
  )
  assert.ok(extension, 'Restly is installed')
  await extension.activate()
  assert.ok(extension.isActive, 'Restly activates')

  const contributed = (
    extension.packageJSON as {contributes: {commands: {command: string}[]}}
  ).contributes.commands.map((c) => c.command)
  const registered = new Set(await vscode.commands.getCommands(true))
  for (const command of contributed) assert.ok(registered.has(command), `${command} is registered`)

  // The fixture collection loads from .restly/ and resolves variables from the
  // active environment, then collection variables.
  await vscode.commands.executeCommand('restly.refresh')
  await vscode.commands.executeCommand('restly.setActiveEnvironment', {
    kind: 'environment',
    id: 'env-dev'
  })
  await vscode.commands.executeCommand('restly.copyAsCurl', {
    kind: 'request',
    collectionId: 'demo',
    id: 'req-users'
  })
  const curl = await vscode.env.clipboard.readText()
  assert.match(curl, /^curl 'https:\/\/api\.dev\.test\/users\?page=2'/)
  assert.match(curl, /-H 'Authorization: Bearer from-collection'/)

  await vscode.commands.executeCommand('restly.openRequest', {
    kind: 'request',
    collectionId: 'demo',
    id: 'req-users'
  })
  await waitFor(() => tabLabels().includes('List users'), 'the request tab')

  await vscode.commands.executeCommand('restly.newRequest')
  await waitFor(() => tabLabels().includes('New Request'), 'the new request tab')

  await vscode.commands.executeCommand('restly.openEnvironment', {
    kind: 'environment',
    id: 'env-dev'
  })
  await waitFor(() => tabLabels().includes('Env: Development'), 'the environment tab')

  console.log('Restly e2e: all checks passed')
}

// Bundles test/e2e/suite.ts and runs it inside a downloaded VS Code against a
// copy of test/e2e/fixture, so the real extension host loads the real bundle.
import {cpSync, mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import * as esbuild from 'esbuild'
import {runTests} from '@vscode/test-electron'

const root = resolve(import.meta.dirname, '..')
const suite = join(root, 'out-e2e', 'suite.js')
await esbuild.build({
  entryPoints: [join(root, 'test/e2e/suite.ts')],
  outfile: suite,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode']
})

// Set when launched from inside VS Code (an integrated terminal or extension);
// it would make the downloaded VS Code start as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE

const temp = mkdtempSync(join(tmpdir(), 'restly-e2e-'))
const workspace = join(temp, 'workspace')
cpSync(join(root, 'test/e2e/fixture'), workspace, {recursive: true})

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: suite,
    launchArgs: [workspace, '--disable-extensions', '--user-data-dir', join(temp, 'user-data')]
  })
} finally {
  rmSync(temp, {recursive: true, force: true})
}

import {rmSync} from 'node:fs'
import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')
const production = process.argv.includes('--production')

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info'
}

const builds = [
  {
    ...common,
    entryPoints: ['src/extension/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode']
  },
  {
    ...common,
    entryPoints: ['src/webview/main.tsx'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    jsxImportSource: 'preact'
  }
]

// Start clean so a production package never carries maps from a dev build.
rmSync('dist', {recursive: true, force: true})

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options)
    await ctx.watch()
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)))
}

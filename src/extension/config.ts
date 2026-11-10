import * as vscode from 'vscode'
import type {SendOptions} from './http/send'

export function sendOptions(): Omit<SendOptions, 'signal'> {
  const c = vscode.workspace.getConfiguration('restly')
  return {
    timeoutMs: c.get<number>('timeout', 30000),
    followRedirects: c.get<boolean>('followRedirects', true),
    maxRedirects: c.get<number>('maxRedirects', 10),
    strictSSL: c.get<boolean>('strictSSL', true)
  }
}

export function userAgent(context: vscode.ExtensionContext): string {
  const version = (context.extension.packageJSON as {version?: string}).version ?? '0.0.0'
  return `Restly/${version}`
}

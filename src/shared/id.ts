export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  const rand = () => Math.random().toString(16).slice(2, 10)
  return `${rand()}-${rand()}-${Date.now().toString(16)}`
}

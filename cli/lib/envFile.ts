import { readFileSync } from 'node:fs'

export function readEnvFile(path: string): Record<string, string> | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  const values: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  }
  return values
}

export function renderEnvFile(values: Record<string, string>): string {
  const header = '# Written by `make provision`. Gitignored: do not commit.\n'
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`)
  return header + lines.join('\n') + '\n'
}

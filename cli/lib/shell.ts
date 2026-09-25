import { spawnSync } from 'node:child_process'

export interface Captured {
  ok: boolean
  stdout: string
  stderr: string
}

export function capture(command: string, args: string[]): Captured {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw new Error(`${command}: ${result.error.message}`)
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

export function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw new Error(`${command}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (exit ${String(result.status)}).`)
  }
}

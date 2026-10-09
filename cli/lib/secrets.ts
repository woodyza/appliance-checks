import { capture } from './shell'

export const DEBUG_TOKEN_SECRET = 'E2E_APPCHECK_DEBUG_TOKEN'

export function secretExists(projectId: string, name: string): boolean {
  return capture('gcloud', ['secrets', 'describe', name, `--project=${projectId}`]).ok
}

// Null only when the secret doesn't exist; any other failure throws, so callers don't mistake a
// permission or network error for "not set up yet".
export function readSecret(projectId: string, name: string): string | null {
  if (!secretExists(projectId, name)) return null
  const accessed = capture('gcloud', ['secrets', 'versions', 'access', 'latest', `--secret=${name}`, `--project=${projectId}`])
  if (!accessed.ok) throw new Error(`Could not read the ${name} secret on ${projectId}: ${accessed.stderr}`)
  return accessed.stdout
}

export function createSecret(projectId: string, name: string, value: string): void {
  const created = capture(
    'gcloud',
    ['secrets', 'create', name, '--data-file=-', '--replication-policy=automatic', `--project=${projectId}`],
    { input: value },
  )
  if (!created.ok) throw new Error(`Could not create the ${name} secret: ${created.stderr}`)
}

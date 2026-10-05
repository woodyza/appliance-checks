import { readEnvFile } from './envFile'
import { capture } from './shell'

export const GMAIL_SECRET_NAME = 'GMAIL_APP_PASSWORD'

export function functionsEnvPath(env: string): string {
  return `functions/.env.${env}`
}

export function gmailSecretExists(projectId: string): boolean {
  return capture('gcloud', ['secrets', 'describe', GMAIL_SECRET_NAME, `--project=${projectId}`]).ok
}

// What `make provision` sets up that the functions deploy needs, so a deploy before provision
// stops early instead of failing partway through.
export function missingFunctionsSetup(env: string, projectId: string): string[] {
  const missing: string[] = []
  if (!gmailSecretExists(projectId)) missing.push(`the ${GMAIL_SECRET_NAME} secret`)
  if (!readEnvFile(functionsEnvPath(env))?.MAIL_FROM) missing.push(`MAIL_FROM in ${functionsEnvPath(env)}`)
  return missing
}

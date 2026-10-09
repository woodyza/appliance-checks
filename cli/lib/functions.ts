import { secretExists } from './secrets'

export const GMAIL_SECRET_NAME = 'GMAIL_APP_PASSWORD'
export const MAIL_FROM_SECRET_NAME = 'MAIL_FROM'

// What `make provision` sets up that the functions deploy needs, so a deploy before provision
// stops early instead of failing partway through.
export function missingFunctionsSetup(projectId: string): string[] {
  return [GMAIL_SECRET_NAME, MAIL_FROM_SECRET_NAME].filter((name) => !secretExists(projectId, name))
}

import { capture } from './shell'

export const SHEETS_WEB_KEY_NAME = 'appliance-checks-sheets-web'
export const WEB_APP_NAME = 'appliance-checks-web'
export const RECAPTCHA_KEY_NAME = 'appliance-checks-web'

export interface WebSdkConfig {
  projectId: string
  appId: string
  apiKey: string
  authDomain: string
}

interface FirebaseApp {
  appId: string
  displayName?: string
}

interface RecaptchaKey {
  name: string
  displayName?: string
}

export function apiKeyName(projectId: string, displayName: string): string | null {
  const listed = capture('gcloud', [
    'services', 'api-keys', 'list', `--project=${projectId}`,
    `--filter=displayName="${displayName}"`, '--format=value(displayName,name)',
  ])
  if (!listed.ok) throw new Error(`Could not list API keys: ${listed.stderr}`)
  const names = listed.stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([name]) => name === displayName)
    .map(([, name]) => name)
  if (names.length > 1) {
    throw new Error(`Found ${names.length} API keys named "${displayName}"; delete the extras in the console.`)
  }
  return names[0] ?? null
}

export function sheetsKeyString(projectId: string, keyName: string): string {
  const keyString = capture('gcloud', [
    'services', 'api-keys', 'get-key-string', keyName, `--project=${projectId}`, '--format=value(keyString)',
  ])
  if (!keyString.ok || !keyString.stdout) throw new Error(`Could not read the browser Sheets API key: ${keyString.stderr}`)
  return keyString.stdout
}

export function findWebAppId(projectId: string): string | null {
  const listed = capture('npx', ['firebase', 'apps:list', 'WEB', '--project', projectId, '--non-interactive', '--json'])
  if (!listed.ok) throw new Error(`Could not list Firebase web apps: ${listed.stderr || listed.stdout}`)
  const apps = (JSON.parse(listed.stdout) as { result?: FirebaseApp[] }).result ?? []
  return apps.find((app) => app.displayName === WEB_APP_NAME)?.appId ?? null
}

export function webSdkConfig(projectId: string, appId: string): WebSdkConfig {
  const result = capture('npx', [
    'firebase', 'apps:sdkconfig', 'WEB', appId,
    '--project', projectId, '--non-interactive', '--json',
  ])
  if (!result.ok) throw new Error(`Could not fetch the web app SDK config: ${result.stderr || result.stdout}`)
  const sdkConfig = (JSON.parse(result.stdout) as { result?: { sdkConfig?: WebSdkConfig } }).result?.sdkConfig
  if (!sdkConfig) throw new Error('Could not find sdkConfig in the apps:sdkconfig output.')
  return sdkConfig
}

export function siteKeyFromName(name: string): string {
  const siteKey = name.split('/').pop()
  if (!siteKey) throw new Error(`Could not parse a site key out of "${name}".`)
  return siteKey
}

export function findRecaptchaSiteKey(projectId: string): string | null {
  const listed = capture('gcloud', ['recaptcha', 'keys', 'list', `--project=${projectId}`, '--format=json'])
  if (!listed.ok) throw new Error(`Could not list reCAPTCHA Enterprise keys: ${listed.stderr}`)
  const keys = JSON.parse(listed.stdout) as RecaptchaKey[]
  const existing = keys.find((key) => key.displayName === RECAPTCHA_KEY_NAME)
  return existing ? siteKeyFromName(existing.name) : null
}

export function lookupViteEnv(env: string, projectId: string): Record<string, string> {
  const notFound = (what: string): Error =>
    new Error(`${what} not found on ${projectId}: run \`make provision ENV=${env}\`.`)

  const appId = findWebAppId(projectId)
  if (!appId) throw notFound(`The web app "${WEB_APP_NAME}"`)
  const config = webSdkConfig(projectId, appId)
  const siteKey = findRecaptchaSiteKey(projectId)
  if (!siteKey) throw notFound(`The reCAPTCHA Enterprise key "${RECAPTCHA_KEY_NAME}"`)
  const sheetsKey = apiKeyName(projectId, SHEETS_WEB_KEY_NAME)
  if (!sheetsKey) throw notFound(`The browser Sheets API key "${SHEETS_WEB_KEY_NAME}"`)

  return {
    VITE_USE_EMULATOR: 'false',
    VITE_FIREBASE_API_KEY: config.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: config.authDomain,
    VITE_FIREBASE_PROJECT_ID: config.projectId,
    VITE_FIREBASE_APP_ID: config.appId,
    VITE_RECAPTCHA_SITE_KEY: siteKey,
    VITE_SHEETS_API_KEY: sheetsKeyString(projectId, sheetsKey),
  }
}

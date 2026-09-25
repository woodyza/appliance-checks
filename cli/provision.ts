import { parseArgs } from 'node:util'
import { assertNoFirebaseToken, firebaseCliAccount, gcloudAccount } from './lib/accounts'
import { type Firebaserc, readFirebaserc, withAlias, writeFirebaserc } from './lib/firebaserc'
import { hasRandomSuffix } from './lib/projectId'
import { confirm } from './lib/prompt'
import { capture, run } from './lib/shell'

const DEFAULT_REGION = 'australia-southeast1'
const SERVICES = [
  'firestore.googleapis.com',
  'firebaserules.googleapis.com',
  'firebasehosting.googleapis.com',
  'sheets.googleapis.com',
  'apikeys.googleapis.com',
]
const SHEETS_KEY_NAME = 'appliance-checks-sheets-cli'
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

interface HostingSite {
  name: string
  type?: string
  defaultUrl?: string
}

function step(message: string): void {
  console.log(`\n→ ${message}`)
}

function ensureProject(env: string, projectId: string): void {
  step(`Project ${projectId}`)
  const gcpExists = capture('gcloud', ['projects', 'describe', projectId, '--format=value(projectId)']).ok
  if (!gcpExists) {
    run('npx', [
      'firebase', 'projects:create', projectId,
      '--display-name', `Appliance Checks (${env})`,
      '--non-interactive',
    ])
    return
  }

  const listed = capture('npx', ['firebase', 'projects:list', '--json'])
  if (!listed.ok) throw new Error(`Could not list Firebase projects: ${listed.stderr || listed.stdout}`)
  const projects = (JSON.parse(listed.stdout) as { result?: { projectId: string }[] }).result ?? []
  if (projects.some((project) => project.projectId === projectId)) {
    console.log('  already exists with Firebase added')
    return
  }
  run('npx', ['firebase', 'projects:addfirebase', projectId, '--non-interactive'])
}

function ensureServices(projectId: string): void {
  step(`APIs: ${SERVICES.join(', ')}`)
  run('gcloud', ['services', 'enable', ...SERVICES, `--project=${projectId}`])
}

function ensureFirestore(projectId: string, region: string): void {
  step('Firestore (default) database')
  const described = capture('gcloud', [
    'firestore', 'databases', 'describe', '--database=(default)', `--project=${projectId}`,
    '--format=value(locationId)',
  ])
  if (!described.ok) {
    run('gcloud', ['firestore', 'databases', 'create', `--location=${region}`, `--project=${projectId}`])
    return
  }
  console.log(`  already exists in ${described.stdout}`)
  if (described.stdout !== region) {
    console.log(`  warning: requested ${region}, but a database's location can't be changed`)
  }
}

function ensureHosting(projectId: string): void {
  step('Hosting site')
  const listed = capture('npx', ['firebase', 'hosting:sites:list', `--project=${projectId}`, '--json'])
  if (!listed.ok) throw new Error(`Could not list Hosting sites: ${listed.stderr || listed.stdout}`)
  const sites = (JSON.parse(listed.stdout) as { result?: { sites?: HostingSite[] } }).result?.sites ?? []

  const defaultSite = sites.find((site) => site.type === 'DEFAULT_SITE') ?? sites[0]
  if (!defaultSite) {
    run('npx', ['firebase', 'hosting:sites:create', projectId, `--project=${projectId}`, '--non-interactive'])
    return
  }
  const siteId = defaultSite.name.split('/').pop()
  console.log(`  already exists: ${defaultSite.defaultUrl ?? siteId}`)
  if (siteId !== projectId) {
    console.log(`  warning: site id "${siteId}" differs from the project id, so CLI-printed QR URLs will be wrong`)
  }
}

function sheetsKeyName(projectId: string): string | null {
  const listed = capture('gcloud', [
    'services', 'api-keys', 'list', `--project=${projectId}`,
    `--filter=displayName="${SHEETS_KEY_NAME}"`, '--format=value(displayName,name)',
  ])
  if (!listed.ok) throw new Error(`Could not list API keys: ${listed.stderr}`)
  const names = listed.stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([displayName]) => displayName === SHEETS_KEY_NAME)
    .map(([, name]) => name)
  if (names.length > 1) {
    throw new Error(`Found ${names.length} API keys named "${SHEETS_KEY_NAME}"; delete the extras in the console.`)
  }
  return names[0] ?? null
}

function ensureSheetsKey(projectId: string): string {
  step(`Sheets API key "${SHEETS_KEY_NAME}"`)
  const existing = sheetsKeyName(projectId)
  if (existing) {
    console.log('  already exists')
    return existing
  }
  // Captured and discarded: gcloud prints the new key string on success.
  const creating = capture('gcloud', [
    'services', 'api-keys', 'create', `--project=${projectId}`,
    `--display-name=${SHEETS_KEY_NAME}`, '--api-target=service=sheets.googleapis.com',
  ])
  if (!creating.ok) throw new Error(`Could not create the Sheets API key: ${creating.stderr}`)
  const created = sheetsKeyName(projectId)
  if (!created) throw new Error('Created the Sheets API key but could not find it afterwards.')
  return created
}

function writeAlias(env: string, updated: Firebaserc | null): void {
  step(`.firebaserc alias "${env}"`)
  if (updated === null) {
    console.log('  already set')
    return
  }
  writeFirebaserc(updated)
  console.log('  written (it is gitignored, keep a note of the ids elsewhere)')
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      env: { type: 'string' },
      'project-id': { type: 'string' },
      region: { type: 'string', default: DEFAULT_REGION },
    },
  })
  const env = values.env
  if (env !== 'dev' && env !== 'prod') throw new Error('--env must be dev or prod.')
  const projectId = values['project-id']
  if (!projectId) throw new Error('--project-id is required.')
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('--project-id must be 6–30 lowercase letters, digits or hyphens, starting with a letter.')
  }
  const region = values.region

  assertNoFirebaseToken()
  const gcloud = gcloudAccount()
  const firebase = firebaseCliAccount()
  console.log(`Environment: ${env}`)
  console.log(`Project id:  ${projectId}`)
  console.log(`Region:      ${region}`)
  console.log(`gcloud account:       ${gcloud}`)
  console.log(`Firebase CLI account: ${firebase}`)
  if (env === 'prod' && !hasRandomSuffix(projectId)) {
    console.log('\nWarning: this prod id has no random suffix (e.g. appliance-checks-7f3kq2), so the site')
    console.log('is easy to guess and find. Project ids are permanent; see docs/infra-setup.md.\n')
  }
  const rc = readFirebaserc() ?? {}
  const aliasUpdate = rc.projects?.[env] === projectId ? null : withAlias(rc, env, projectId)
  console.log(`.firebaserc ${env}:     ${aliasUpdate === null ? 'already set' : 'will be written'}`)
  if (gcloud.toLowerCase() !== firebase.toLowerCase()) {
    throw new Error('The gcloud and Firebase CLI accounts differ. Switch one so they match, then re-run.')
  }
  await confirm(`Provision ${env} as ${gcloud}? [y/N] `)

  ensureProject(env, projectId)
  ensureServices(projectId)
  ensureFirestore(projectId, region)
  ensureHosting(projectId)
  const keyName = ensureSheetsKey(projectId)
  writeAlias(env, aliasUpdate)

  console.log('\nDone. To use the Sheets API key in this shell:')
  console.log(`  export SHEETS_API_KEY=$(gcloud services api-keys get-key-string ${keyName} --format='value(keyString)')`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

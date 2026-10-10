import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { isValidEmail } from '../src/domain/adminUser'
import {
  assertAccountsMatch,
  assertNoFirebaseToken,
  firebaseCliAccount,
  gcloudAccessToken,
  gcloudAccount,
} from './lib/accounts'
import { KILL_SWITCH_SERVICE_ACCOUNT_ID, KILL_SWITCH_TOPIC } from '../functions/src/killSwitch'
import {
  billingAccount,
  billingEnabled,
  findKillSwitchBudget,
  killSwitchBudgetName,
  listBudgets,
} from './lib/billing'
import {
  GMAIL_SECRET_NAME,
  killSwitchServiceAccount,
  MAIL_FROM_SECRET_NAME,
  serviceAccountExists,
  topicExists,
} from './lib/functions'
import { ENV_LABEL, hasRandomSuffix, labelledProjectIds, projectNumber, provisionProjectId } from './lib/projectId'
import { askText, confirm } from './lib/prompt'
import { createSecret, DEBUG_TOKEN_SECRET, readSecret, secretExists } from './lib/secrets'
import { capture, run } from './lib/shell'
import {
  apiKeyName,
  findRecaptchaSiteKey,
  findWebAppId,
  RECAPTCHA_KEY_NAME,
  SHEETS_WEB_KEY_NAME,
  sheetsWebReferrers,
  siteKeyFromName,
  WEB_APP_NAME,
} from './lib/webApp'

const DEFAULT_REGION = 'australia-southeast1'
const SERVICES = [
  'firestore.googleapis.com',
  'firebaserules.googleapis.com',
  'firebasehosting.googleapis.com',
  'sheets.googleapis.com',
  'apikeys.googleapis.com',
  'firebaseappcheck.googleapis.com',
  'recaptchaenterprise.googleapis.com',
  'identitytoolkit.googleapis.com',
  'cloudresourcemanager.googleapis.com',
]
const FUNCTIONS_SERVICES = [
  'cloudfunctions.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'run.googleapis.com',
  'eventarc.googleapis.com',
  'cloudscheduler.googleapis.com',
  'secretmanager.googleapis.com',
]
const KILL_SWITCH_SERVICES = ['pubsub.googleapis.com', 'cloudbilling.googleapis.com', 'billingbudgets.googleapis.com']
// In the billing account's currency. Normal use is close to nothing, so this only trips on abuse.
const KILL_SWITCH_BUDGET = '10'
const KILL_SWITCH_THRESHOLDS = ['0.5', '0.9', '1.0']
const BUDGET_PERMISSIONS = ['billing.budgets.create', 'billing.budgets.list', 'billing.budgets.update']
// The service account Cloud Billing publishes budget notifications as.
const BUDGET_PUBLISHER = 'serviceAccount:billing-budget-alert@system.gserviceaccount.com'
const SHEETS_KEY_NAME = 'appliance-checks-sheets-cli'
const RECAPTCHA_MIN_SCORE = 0.3
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
      '--display-name', `Appliance Checks ${env}`,
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

// GA gcloud can't set project labels (only `gcloud alpha` can), so this uses the Resource Manager
// API. Patching `labels` replaces the whole map, so the existing labels (eg `firebase`) are merged in.
async function ensureLabel(env: string, projectId: string, labelled: boolean): Promise<void> {
  step(`Project label ${ENV_LABEL}=${env}`)
  if (labelled) {
    console.log('  already set')
    return
  }
  const url = `${RESOURCE_MANAGER_API}/projects/${projectId}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${gcloudAccessToken()}`, 'x-goog-user-project': projectId },
  })
  if (!response.ok) throw new Error(`GET ${url} failed (${String(response.status)}): ${await response.text()}`)
  const { labels } = (await response.json()) as { labels?: Record<string, string> }
  await restPatch(projectId, url, { labels: { ...labels, [ENV_LABEL]: env } }, ['labels'])
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
    console.log(`  warning: site id "${siteId}" differs from the project id, so CLI-printed Brigade Links will be wrong`)
  }
}

function ensureSheetsKey(projectId: string): string {
  step(`Sheets API key "${SHEETS_KEY_NAME}"`)
  const existing = apiKeyName(projectId, SHEETS_KEY_NAME)
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
  const created = apiKeyName(projectId, SHEETS_KEY_NAME)
  if (!created) throw new Error('Created the Sheets API key but could not find it afterwards.')
  return created
}

// The browser import's key ends up in the bundle, so it's restricted to the Sheets API and to this
// site's origins (plus the Vite dev server on `dev`). A re-run resets an existing key to the same
// restrictions, so a changed referrer list reaches keys created earlier.
function ensureSheetsWebKey(env: string, projectId: string): void {
  step(`Browser Sheets API key "${SHEETS_WEB_KEY_NAME}"`)
  const restrictions = [
    '--api-target=service=sheets.googleapis.com',
    `--allowed-referrers=${sheetsWebReferrers(env, projectId).join(',')}`,
  ]
  const existing = apiKeyName(projectId, SHEETS_WEB_KEY_NAME)
  if (existing) {
    const updating = capture('gcloud', ['services', 'api-keys', 'update', existing, `--project=${projectId}`, ...restrictions])
    if (!updating.ok) throw new Error(`Could not update the browser Sheets API key: ${updating.stderr}`)
    console.log('  already exists; referrers updated')
    return
  }
  const creating = capture('gcloud', [
    'services', 'api-keys', 'create', `--project=${projectId}`,
    `--display-name=${SHEETS_WEB_KEY_NAME}`, ...restrictions,
  ])
  if (!creating.ok) throw new Error(`Could not create the browser Sheets API key: ${creating.stderr}`)
}

function ensureWebApp(projectId: string): string {
  step(`Web app "${WEB_APP_NAME}"`)
  const existing = findWebAppId(projectId)
  if (existing) {
    console.log(`  already exists: ${existing}`)
    return existing
  }

  const created = capture('npx', [
    'firebase', 'apps:create', 'WEB', WEB_APP_NAME,
    '--project', projectId, '--non-interactive', '--json',
  ])
  if (!created.ok) throw new Error(`Could not create the Firebase web app: ${created.stderr || created.stdout}`)
  const appId = (JSON.parse(created.stdout) as { result?: { appId: string } }).result?.appId
  if (!appId) throw new Error('Created the Firebase web app but its app id was missing from the response.')
  return appId
}

function ensureRecaptchaKey(projectId: string): string {
  step(`reCAPTCHA Enterprise key "${RECAPTCHA_KEY_NAME}"`)
  const existing = findRecaptchaSiteKey(projectId)
  if (existing) {
    console.log(`  already exists: ${existing}`)
    return existing
  }

  const domains = `${projectId}.web.app,${projectId}.firebaseapp.com`
  const created = capture('gcloud', [
    'recaptcha', 'keys', 'create',
    `--project=${projectId}`, `--display-name=${RECAPTCHA_KEY_NAME}`,
    '--web', `--domains=${domains}`, '--integration-type=score', '--format=json',
  ])
  if (!created.ok) throw new Error(`Could not create the reCAPTCHA Enterprise key: ${created.stderr}`)
  return siteKeyFromName((JSON.parse(created.stdout) as { name: string }).name)
}

const APP_CHECK_API = 'https://firebaseappcheck.googleapis.com/v1'
const IDENTITY_TOOLKIT_API = 'https://identitytoolkit.googleapis.com'
const RESOURCE_MANAGER_API = 'https://cloudresourcemanager.googleapis.com/v3'

// The App Check provider/enforcement commands in firebase-tools are behind its `appcheckadmin`
// preview experiment, and no firebase-tools command enables the Auth Email provider, so these
// call the REST APIs directly, as firebase-tools itself does for App Check.
async function restPatch(projectId: string, url: string, body: object, updateMask: string[]): Promise<void> {
  const patchUrl = `${url}?updateMask=${updateMask.join(',')}`
  const response = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${gcloudAccessToken()}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': projectId,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`PATCH ${url} failed (${String(response.status)}): ${await response.text()}`)
}

async function setAppCheckProvider(projectId: string, number: string, appId: string, siteKey: string): Promise<void> {
  step('App Check provider: reCAPTCHA Enterprise')
  await restPatch(
    projectId,
    `${APP_CHECK_API}/projects/${number}/apps/${appId}/recaptchaEnterpriseConfig`,
    { siteKey, tokenTtl: '3600s', riskAnalysis: { minValidScore: RECAPTCHA_MIN_SCORE } },
    ['siteKey', 'tokenTtl', 'riskAnalysis.minValidScore'],
  )
}

async function enforceFirestore(projectId: string, number: string): Promise<void> {
  step('App Check enforcement: Firestore')
  await restPatch(
    projectId,
    `${APP_CHECK_API}/projects/${number}/services/firestore.googleapis.com`,
    { enforcementMode: 'ENFORCED' },
    ['enforcementMode'],
  )
}

async function enableEmailLinkSignIn(projectId: string): Promise<void> {
  step('Auth Email provider (passwordless)')
  try {
    await restPatch(
      projectId,
      `${IDENTITY_TOOLKIT_API}/admin/v2/projects/${projectId}/config`,
      { signIn: { email: { enabled: true, passwordRequired: false } } },
      ['signIn.email.enabled', 'signIn.email.passwordRequired'],
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('CONFIGURATION_NOT_FOUND')) throw error
    throw new Error(
      `${message}\nAuth hasn't been started on this project: click "Get started" under Authentication in the ` +
        'Firebase console once, then re-run.',
      { cause: error },
    )
  }
}

// Might need the Identity Platform upgrade on some projects (on `dev` it went through on Spark
// without it); warn and carry on rather than failing the rest of provisioning.
async function enforceAuth(projectId: string, number: string): Promise<void> {
  step('App Check enforcement: Auth')
  try {
    await restPatch(
      projectId,
      `${APP_CHECK_API}/projects/${number}/services/identitytoolkit.googleapis.com`,
      { enforcementMode: 'ENFORCED' },
      ['enforcementMode'],
    )
  } catch (error) {
    console.log(`  warning: could not enforce App Check on Auth: ${error instanceof Error ? error.message : String(error)}`)
    console.log('  continuing without it; see docs/infra-setup.md')
  }
}

function ensureDebugToken(env: string, projectId: string, appId: string, billed: boolean): void {
  if (env !== 'dev') return
  step('App Check debug token (dev only, for e2e)')
  if (!billed) {
    console.log(`  warning: billing isn't enabled on ${projectId}, so \`make e2e ENV=dev\` can't run; skipping`)
    return
  }
  run('gcloud', ['services', 'enable', 'secretmanager.googleapis.com', `--project=${projectId}`])
  // Stored before it's registered, so a failed registration is retried with the same value.
  let token = readSecret(projectId, DEBUG_TOKEN_SECRET)
  if (token === null) {
    token = randomUUID()
    createSecret(projectId, DEBUG_TOKEN_SECRET, token)
  }
  // --json (captured, not streamed to the terminal) so the token itself never lands in scrollback.
  const created = capture('npx', [
    'firebase', 'appcheck:debugtokens:create', token,
    '--app', appId, '--display-name', 'appliance-checks-e2e', '--force',
    '--project', projectId, '--non-interactive', '--json',
  ])
  if (!created.ok) throw new Error(`Could not create the App Check debug token: ${created.stderr}`)
  console.log(`  registered (kept out of scrollback; stored in Secret Manager as ${DEBUG_TOKEN_SECRET})`)
}

async function ensureFunctions(projectId: string, region: string, billed: boolean): Promise<void> {
  step('Cloud Functions (weekly VSO email)')
  if (!billed) {
    console.log(`  warning: billing isn't enabled on ${projectId}, so functions can't deploy; skipping`)
    return
  }

  console.log(`  APIs: ${FUNCTIONS_SERVICES.join(', ')}`)
  run('gcloud', ['services', 'enable', ...FUNCTIONS_SERVICES, `--project=${projectId}`])

  if (secretExists(projectId, GMAIL_SECRET_NAME)) {
    console.log(`  secret ${GMAIL_SECRET_NAME} already exists`)
  } else {
    console.log(`  creating secret ${GMAIL_SECRET_NAME}: paste the Gmail app password when prompted`)
    run('npx', ['firebase', 'functions:secrets:set', GMAIL_SECRET_NAME, '--project', projectId])
  }

  if (secretExists(projectId, MAIL_FROM_SECRET_NAME)) {
    console.log(`  secret ${MAIL_FROM_SECRET_NAME} already exists`)
  } else {
    const mailFrom = (await askText('  MAIL_FROM (the Gmail address the email is sent from): ')).toLowerCase()
    if (!isValidEmail(mailFrom)) throw new Error(`"${mailFrom}" is not a valid email address.`)
    const created = capture(
      'npx',
      ['firebase', 'functions:secrets:set', MAIL_FROM_SECRET_NAME, '--data-file', '-', '--project', projectId, '--non-interactive'],
      { input: mailFrom },
    )
    if (!created.ok) throw new Error(`Could not create the ${MAIL_FROM_SECRET_NAME} secret: ${created.stderr || created.stdout}`)
    console.log(`  secret ${MAIL_FROM_SECRET_NAME} created`)
  }

  run('npx', ['firebase', 'functions:artifacts:setpolicy', '--location', region, '--force', '--project', projectId])
}

// Budgets live on the billing account, so creating one needs a billing-account role that owning
// the project doesn't give. Checked before the rest of provisioning rather than failing at the end.
async function assertBudgetPermissions(projectId: string): Promise<void> {
  step('Billing account permissions for the kill switch budget')
  run('gcloud', ['services', 'enable', ...KILL_SWITCH_SERVICES, `--project=${projectId}`])
  const account = billingAccount(projectId)
  const url = `https://cloudbilling.googleapis.com/v1/${account}:testIamPermissions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${gcloudAccessToken()}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': projectId,
    },
    body: JSON.stringify({ permissions: BUDGET_PERMISSIONS }),
  })
  if (!response.ok) throw new Error(`POST ${url} failed (${String(response.status)}): ${await response.text()}`)
  const granted = ((await response.json()) as { permissions?: string[] }).permissions ?? []
  const missing = BUDGET_PERMISSIONS.filter((permission) => !granted.includes(permission))
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')} on ${account}: provisioning a billed project needs Billing Account ` +
        'Administrator (or Billing Account Costs Manager) on its billing account; see docs/infra-setup.md.',
    )
  }
  console.log(`  ok on ${account}`)
}

// A newly created service account can take a few seconds to be visible to IAM policy updates.
async function addBinding(args: string[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const added = capture('gcloud', [...args, '--quiet', '--format=none'])
    if (added.ok) return
    if (attempt === 5) throw new Error(`gcloud ${args.join(' ')} failed: ${added.stderr}`)
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}

async function ensureKillSwitch(env: string, projectId: string, number: string, billed: boolean): Promise<void> {
  step('Billing kill switch')
  if (!billed) {
    console.log(`  warning: billing isn't enabled on ${projectId}, so there's nothing to cap; skipping`)
    return
  }

  if (topicExists(projectId)) {
    console.log(`  topic ${KILL_SWITCH_TOPIC} already exists`)
  } else {
    run('gcloud', ['pubsub', 'topics', 'create', KILL_SWITCH_TOPIC, `--project=${projectId}`])
  }

  const serviceAccount = killSwitchServiceAccount(projectId)
  if (serviceAccountExists(projectId)) {
    console.log(`  service account ${serviceAccount} already exists`)
  } else {
    run('gcloud', [
      'iam', 'service-accounts', 'create', KILL_SWITCH_SERVICE_ACCOUNT_ID,
      '--display-name=Billing kill switch', `--project=${projectId}`,
    ])
  }
  // run.invoker because Pub/Sub pushes to the function as this account, and firebase-tools only
  // grants that to the default compute account.
  for (const role of ['roles/billing.projectManager', 'roles/run.invoker']) {
    await addBinding([
      'projects', 'add-iam-policy-binding', projectId,
      `--member=serviceAccount:${serviceAccount}`, `--role=${role}`, '--condition=None',
    ])
  }
  await addBinding([
    'pubsub', 'topics', 'add-iam-policy-binding', KILL_SWITCH_TOPIC, `--project=${projectId}`,
    `--member=${BUDGET_PUBLISHER}`, '--role=roles/pubsub.publisher',
  ])
  console.log(`  ${serviceAccount} can unlink billing; budget notifications can publish to ${KILL_SWITCH_TOPIC}`)

  // A re-run resets the amount, topic and thresholds, so a changed budget reaches existing projects.
  const account = billingAccount(projectId)
  const budgetName = killSwitchBudgetName(env)
  const settings = [
    `--billing-project=${projectId}`, `--budget-amount=${KILL_SWITCH_BUDGET}`,
    `--notifications-rule-pubsub-topic=projects/${projectId}/topics/${KILL_SWITCH_TOPIC}`,
  ]
  const existing = findKillSwitchBudget(listBudgets(account, projectId), budgetName, number)
  if (existing) {
    // The full `billingAccounts/X/budgets/Y` name; adding `--billing-account` here would prefix it twice.
    run('gcloud', [
      'billing', 'budgets', 'update', existing.name, ...settings, '--clear-threshold-rules',
      ...KILL_SWITCH_THRESHOLDS.map((percent) => `--add-threshold-rule=percent=${percent}`),
    ])
    console.log(`  budget ${budgetName} already exists; reset to ${KILL_SWITCH_BUDGET}`)
  } else {
    run('gcloud', [
      'billing', 'budgets', 'create', `--billing-account=${account}`, `--display-name=${budgetName}`,
      `--filter-projects=projects/${projectId}`, ...settings,
      ...KILL_SWITCH_THRESHOLDS.map((percent) => `--threshold-rule=percent=${percent}`),
    ])
  }
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
  const labelled = labelledProjectIds(env)
  const projectId = provisionProjectId(env, values['project-id'], labelled)
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
    console.log('\nWarning: this prod id has no random suffix (e.g. appliance-checks-<6 random letters and digits>), so the site')
    console.log('is easy to guess and find. Project ids are permanent; see docs/infra-setup.md.\n')
  }
  const otherEnv = env === 'dev' ? 'prod' : 'dev'
  if (labelledProjectIds(otherEnv).includes(projectId)) {
    throw new Error(`${projectId} is labelled \`${ENV_LABEL}=${otherEnv}\`: did you mean ENV=${otherEnv}?`)
  }
  const alreadyLabelled = labelled.includes(projectId)
  console.log(`label ${env}:     ${alreadyLabelled ? 'already set' : 'will be added'}`)
  assertAccountsMatch(gcloud, firebase)
  await confirm(`Provision ${env} as ${gcloud}? [y/N] `)

  ensureProject(env, projectId)
  ensureServices(projectId)
  await ensureLabel(env, projectId, alreadyLabelled)
  const billed = billingEnabled(projectId)
  if (billed) await assertBudgetPermissions(projectId)
  ensureFirestore(projectId, region)
  ensureHosting(projectId)
  const appId = ensureWebApp(projectId)
  const siteKey = ensureRecaptchaKey(projectId)
  const number = projectNumber(projectId)
  await setAppCheckProvider(projectId, number, appId, siteKey)
  await enforceFirestore(projectId, number)
  await enableEmailLinkSignIn(projectId)
  await enforceAuth(projectId, number)
  ensureDebugToken(env, projectId, appId, billed)
  ensureSheetsWebKey(env, projectId)
  const keyName = ensureSheetsKey(projectId)
  await ensureFunctions(projectId, region, billed)
  await ensureKillSwitch(env, projectId, number, billed)

  console.log('\nDone. To use the Sheets API key in this shell:')
  console.log(`  export SHEETS_API_KEY=$(gcloud services api-keys get-key-string ${keyName} --format='value(keyString)')`)
  console.log('\nTo make yourself the superadmin, sign in once at /admin/sign-in, then:')
  console.log(`  npm run cli:set-superadmin -- --project ${env} --email <you>`)
  console.log('\nNote: App Check enforcement (Firestore and Auth) can take up to 15 minutes to take effect.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

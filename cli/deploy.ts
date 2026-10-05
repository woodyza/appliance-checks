import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { assertNoFirebaseToken, firebaseCliAccount } from './lib/accounts'
import { billingEnabled } from './lib/billing'
import { readEnvFile } from './lib/envFile'
import { missingFunctionsSetup } from './lib/functions'
import { confirm } from './lib/prompt'
import { substituteSuperadmin } from './lib/rules'
import { run } from './lib/shell'
import { readProjectId } from './lib/target'

const DEPLOY_CONFIG_PATH = 'firebase.deploy.json'
const DEPLOY_RULES_PATH = '.deploy/firestore.rules'

interface FirebaseConfig {
  firestore: { rules: string; indexes: string }
  [key: string]: unknown
}

// `firebase deploy --config <file>` resolves every other path (dist, indexes, .firebaserc) from
// that file's directory, so this config stays at the repo root, identical to firebase.json except
// for the rules path, rather than living under .deploy/ itself.
function writeDeployConfig(): void {
  const config = JSON.parse(readFileSync('firebase.json', 'utf8')) as FirebaseConfig
  config.firestore = { ...config.firestore, rules: DEPLOY_RULES_PATH }
  writeFileSync(DEPLOY_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
}

async function main(): Promise<void> {
  assertNoFirebaseToken()

  const { values } = parseArgs({ options: { project: { type: 'string' } } })
  const env = values.project
  if (env !== 'dev' && env !== 'prod') {
    throw new Error('--project must be dev or prod.')
  }

  const envValues = readEnvFile(`.env.${env}`)
  if (envValues === null) {
    throw new Error(`.env.${env} not found: run \`make provision ENV=${env} PROJECT_ID=<id>\` first.`)
  }

  const projectId = readProjectId(env)
  const email = firebaseCliAccount()
  console.log(`Project: ${projectId} (${env})`)
  console.log(`Firebase CLI account: ${email}`)

  const superadminUid = envValues.SUPERADMIN_UID
  const rules = substituteSuperadmin(readFileSync('firestore.rules', 'utf8'), superadminUid)
  if (!superadminUid) {
    console.log(
      `\nWarning: no superadmin yet: sign in, copy the UID from the "not authorised" screen into .env.${env}, ` +
        'redeploy.\n',
    )
  }

  const targets = ['hosting', 'firestore:rules', 'firestore:indexes']
  if (billingEnabled(projectId)) {
    const missing = missingFunctionsSetup(env, projectId)
    if (missing.length > 0) {
      throw new Error(`Functions aren't set up on ${projectId} (missing ${missing.join(' and ')}): run \`make provision ENV=${env}\` first.`)
    }
    targets.push('functions')
  } else {
    console.log(`Billing isn't enabled on ${projectId}: skipping functions (see #23).`)
  }

  await confirm(`Deploy to ${env}? [y/N] `)

  run('npx', ['vite', 'build', '--mode', env])

  mkdirSync('.deploy', { recursive: true })
  writeFileSync(DEPLOY_RULES_PATH, rules)
  writeDeployConfig()

  run('npx', [
    'firebase', 'deploy',
    '--project', env,
    '--config', DEPLOY_CONFIG_PATH,
    '--only', targets.join(','),
  ])
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

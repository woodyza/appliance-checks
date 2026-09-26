import { parseArgs } from 'node:util'
import { assertNoFirebaseToken, firebaseCliAccount } from './lib/accounts'
import { readEnvFile } from './lib/envFile'
import { confirm } from './lib/prompt'
import { run } from './lib/shell'
import { readProjectId } from './lib/target'

async function main(): Promise<void> {
  assertNoFirebaseToken()

  const { values } = parseArgs({ options: { project: { type: 'string' } } })
  const env = values.project
  if (env !== 'dev' && env !== 'prod') {
    throw new Error('--project must be dev or prod.')
  }

  if (readEnvFile(`.env.${env}`) === null) {
    throw new Error(`.env.${env} not found: run \`make provision ENV=${env} PROJECT_ID=<id>\` first.`)
  }

  const projectId = readProjectId(env)
  const email = firebaseCliAccount()
  console.log(`Project: ${projectId} (${env})`)
  console.log(`Firebase CLI account: ${email}`)
  await confirm(`Deploy to ${env}? [y/N] `)

  run('npx', ['vite', 'build', '--mode', env])
  run('npx', ['firebase', 'deploy', '--project', env, '--only', 'hosting,firestore:rules,firestore:indexes'])
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

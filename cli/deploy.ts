import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { confirm } from './lib/prompt'
import { readProjectId } from './lib/target'

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (exit ${String(result.status)}).`)
  }
}

function loggedInAccountEmail(): string {
  const result = spawnSync('npx', ['firebase', 'login:list'], { encoding: 'utf8' })
  const match = /Logged in as (\S+)/.exec(result.stdout)
  if (!match) {
    throw new Error('No Firebase CLI account is logged in. Run `firebase login` first.')
  }
  return match[1]
}

async function main(): Promise<void> {
  if (process.env.FIREBASE_TOKEN) {
    throw new Error(
      'FIREBASE_TOKEN is set: deploy would authenticate with that token instead of the account shown by ' +
        '`firebase login:list`. Unset it before deploying interactively.',
    )
  }

  const { values } = parseArgs({ options: { project: { type: 'string' } } })
  const env = values.project
  if (env !== 'dev' && env !== 'prod') {
    throw new Error('--project must be dev or prod.')
  }

  const projectId = readProjectId(env)
  const email = loggedInAccountEmail()
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

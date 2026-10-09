import { DEBUG_TOKEN_SECRET, readSecret } from './lib/secrets'
import { run } from './lib/shell'
import { readProjectId } from './lib/target'

async function main(): Promise<void> {
  const projectId = readProjectId('dev')
  const debugToken = readSecret(projectId, DEBUG_TOKEN_SECRET)
  if (debugToken === null) {
    throw new Error(
      `No ${DEBUG_TOKEN_SECRET} secret on ${projectId}: e2e against dev needs billing on dev; run \`make provision ENV=dev\`.`,
    )
  }

  run('npm', ['run', 'e2e:seed', '--', '--project', 'dev'])
  run('npx', ['playwright', 'test'], {
    E2E_ENV: 'dev',
    E2E_BASE_URL: `https://${projectId}.web.app`,
    E2E_APPCHECK_DEBUG_TOKEN: debugToken,
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

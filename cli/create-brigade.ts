import { parseArgs } from 'node:util'
import { createBrigade } from './lib/store'
import { hostingBaseUrl, parseProjectTarget, resolveTarget } from './lib/target'

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      'check-day': { type: 'string' },
      project: { type: 'string' },
    },
  })

  if (!values.name) {
    throw new Error('--name is required.')
  }
  const checkDay = Number(values['check-day'])
  if (!Number.isInteger(checkDay) || checkDay < 1 || checkDay > 7) {
    throw new Error('--check-day is required and must be an integer from 1 to 7 (Mon=1).')
  }

  const target = parseProjectTarget(values.project)
  const db = await resolveTarget(target)
  const { slug, brigadeId } = await createBrigade(db, { name: values.name, checkDay })

  console.log(`Brigade created: ${values.name} (brigadeId ${brigadeId})`)
  console.log(`Brigade Link: ${hostingBaseUrl(target)}/${slug}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

import { parseArgs } from 'node:util'
import {
  completeResponses,
  deleteChecks,
  fixtureCheckSheet,
  writeBrigade,
  writePreviousCheck,
} from './lib/seed'
import { parseProjectTarget, resolveTarget } from './lib/target'

const SLUG = 'e2etst'

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { project: { type: 'string' } } })
  if (values.project === 'prod') throw new Error('--project must not be prod.')
  const db = await resolveTarget(parseProjectTarget(values.project))

  const { sections, ids } = fixtureCheckSheet()
  await writeBrigade(db, {
    slug: SLUG,
    name: 'E2E Test Brigade',
    appliances: [
      { id: 'e2e1', callsign: 'E2E 1' },
      { id: 'e2e2', callsign: 'E2E 2' },
    ],
    sections,
  })
  await deleteChecks(db, SLUG)
  await writePreviousCheck(db, SLUG, 'e2e1', completeResponses(ids))
  await writePreviousCheck(db, SLUG, 'e2e2', { [ids.torch]: 'Y' })

  console.log(`Seeded brigade "${SLUG}" with appliances e2e1, e2e2.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

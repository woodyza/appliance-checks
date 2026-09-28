import { parseArgs } from 'node:util'
import {
  completeResponses,
  deleteChecks,
  ensureSuperadminUser,
  firstTwoCheckDaysOfPreviousMonth,
  fixtureCheckSheet,
  fixtureCheckSheetE2e3,
  writeBrigade,
  writeCheck,
  writePreviousCheck,
  writeVersionedAppliance,
} from './lib/seed'
import { adminAuth, parseProjectTarget, resolveTarget } from './lib/target'

const SLUG = 'e2etst'

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { project: { type: 'string' } } })
  if (values.project === 'prod') throw new Error('--project must not be prod.')
  const target = parseProjectTarget(values.project)
  const db = await resolveTarget(target)

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

  const e2e3 = fixtureCheckSheetE2e3()
  await writeVersionedAppliance(db, SLUG, { id: 'e2e3', callsign: 'E2E 3' }, [e2e3.v1, e2e3.v2])
  const brigadeSnapshot = await db.collection('brigades').doc(SLUG).get()
  const checkDay = brigadeSnapshot.data()?.checkDay as number
  const [firstDate, secondDate] = firstTwoCheckDaysOfPreviousMonth(checkDay)
  await writeCheck(db, SLUG, 'e2e3', firstDate, 1, completeResponses(e2e3.ids))
  await writeCheck(db, SLUG, 'e2e3', secondDate, 2, { [e2e3.ids.torch]: 'Y' })

  // The Auth emulator only: e2e-seed against `dev` uses a real superadmin (see docs/infra-setup.md).
  if (target === 'emulator') await ensureSuperadminUser(adminAuth())

  console.log(`Seeded brigade "${SLUG}" with appliances e2e1, e2e2, e2e3.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

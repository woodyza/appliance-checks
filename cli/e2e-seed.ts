import { parseArgs } from 'node:util'
import { currentCheckDate, today, weekday } from '../src/domain/schedule'
import {
  completeResponses,
  deleteAppliancesAndChecks,
  deleteChecks,
  ensureSuperadminUser,
  firstTwoCheckDaysOfPreviousMonth,
  fixtureCheckSheet,
  fixtureCheckSheetE2e3,
  writeBrigade,
  writeCheck,
  writeApplianceWithoutCheckSheet,
  writePreviousCheck,
  writeVersionedAppliance,
} from './lib/seed'
import { adminAuth, parseProjectTarget, resolveTarget } from './lib/target'

const SLUG = 'e2etst'
const INACTIVE_SLUG = 'e2ezzz'
const EDITOR_SLUG = 'e2eedt'

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

  await writeBrigade(db, {
    slug: INACTIVE_SLUG,
    name: 'E2E Inactive Brigade',
    appliances: [{ id: 'e2ez1', callsign: 'E2E Z1' }],
    sections,
    active: false,
  })

  // The editor specs add, edit and publish freely, so this brigade is rebuilt from scratch.
  await deleteAppliancesAndChecks(db, EDITOR_SLUG)
  const editor = fixtureCheckSheet()
  await writeBrigade(db, {
    slug: EDITOR_SLUG,
    name: 'E2E Editor Brigade',
    appliances: ['e2ed1', 'e2ed2', 'e2ed3', 'e2ed4', 'e2ed5', 'e2ed7'].map((id) => ({
      id,
      callsign: `E2E D${id.slice(-1)}`,
    })),
    sections: editor.sections,
  })
  await writeApplianceWithoutCheckSheet(db, EDITOR_SLUG, { id: 'e2ed6', callsign: 'E2E D6' })
  await writeCheck(db, EDITOR_SLUG, 'e2ed3', currentCheckDate(today(), weekday(today())), 1, completeResponses(editor.ids))

  // The Auth emulator only: e2e-seed against `dev` uses a real superadmin (see docs/infra-setup.md).
  if (target === 'emulator') await ensureSuperadminUser(adminAuth())

  console.log(`Seeded brigade "${SLUG}" with appliances e2e1, e2e2, e2e3, inactive brigade "${INACTIVE_SLUG}" with e2ez1, and editor brigade "${EDITOR_SLUG}" with e2ed1-e2ed7.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

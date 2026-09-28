import { parseArgs } from 'node:util'
import {
  completeResponses,
  deleteChecks,
  ensureSuperadminUser,
  fixtureCheckSheet,
  writeBrigade,
  writePreviousCheck,
} from './lib/seed'
import { adminAuth, hostingBaseUrl, resolveTarget } from './lib/target'

const SLUG = 'devtst'
const APPLIANCES = [
  { id: 'dev1', callsign: 'Local 1' },
  { id: 'dev2', callsign: 'Local 2' },
]
const FIRESTORE_EMULATOR_URL = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}/`
const AUTH_EMULATOR_URL = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}/`
const WAIT_MS = 120_000

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`The emulator didn't come up at ${url} within ${String(WAIT_MS / 1000)}s.`)
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { reset: { type: 'boolean', default: false } } })

  await Promise.all([waitFor(FIRESTORE_EMULATOR_URL), waitFor(AUTH_EMULATOR_URL)])
  const db = await resolveTarget('emulator')
  await ensureSuperadminUser(adminAuth())

  const exists = (await db.collection('brigades').doc(SLUG).get()).exists
  if (exists && !values.reset) {
    console.log(`Brigade "${SLUG}" already seeded (npm run dev:seed -- --reset to start again).`)
  } else {
    const { sections, ids } = fixtureCheckSheet()
    await writeBrigade(db, { slug: SLUG, name: 'Local Brigade', appliances: APPLIANCES, sections })
    await deleteChecks(db, SLUG)
    await writePreviousCheck(db, SLUG, 'dev1', completeResponses(ids))
    console.log(`Seeded brigade "${SLUG}".`)
  }

  const base = hostingBaseUrl('emulator')
  console.log(`  Brigade Link: ${base}/${SLUG}`)
  for (const appliance of APPLIANCES) console.log(`  ${appliance.callsign}: ${base}/${SLUG}/${appliance.id}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

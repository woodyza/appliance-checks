import { parseArgs } from 'node:util'
import type { Firestore } from 'firebase-admin/firestore'
import {
  completeResponses,
  deleteChecks,
  ensureSuperadminUser,
  fixtureCheckSheet,
  SUPERADMIN_EMAIL,
  type SeedAdminUserInput,
  writeAdminUser,
  writeBrigade,
  writePreviousCheck,
} from './lib/seed'
import { adminAuth, hostingBaseUrl, resolveTarget } from './lib/target'

const SLUG = 'devtst'
const APPLIANCES = [
  { id: 'dev1', callsign: 'Local 1' },
  { id: 'dev2', callsign: 'Local 2' },
]
const ADMIN_USERS: { label: string; user: SeedAdminUserInput }[] = [
  { label: 'VSO', user: { email: 'dev-vso@example.com', role: 'vso', brigadeSlugs: [SLUG] } },
  {
    label: 'Brigade Admin',
    user: { email: 'dev-brigade-admin@example.com', role: 'brigadeAdmin', brigadeSlugs: [SLUG] },
  },
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
  const reseeded = !exists || values.reset
  if (reseeded) {
    const { sections, ids } = fixtureCheckSheet()
    await writeBrigade(db, { slug: SLUG, name: 'Local Brigade', appliances: APPLIANCES, sections })
    await deleteChecks(db, SLUG)
    await writePreviousCheck(db, SLUG, 'dev1', completeResponses(ids))
    console.log(`Seeded brigade "${SLUG}".`)
  } else {
    console.log(`Brigade "${SLUG}" already seeded (npm run dev:seed -- --reset to start again).`)
  }
  await writeMissingAdminUsers(db, reseeded)

  const base = hostingBaseUrl('emulator')
  console.log(`  Brigade Link: ${base}/${SLUG}`)
  for (const appliance of APPLIANCES) console.log(`  ${appliance.callsign}: ${base}/${SLUG}/${appliance.id}`)
  console.log('')
  console.log(`Sign in at ${base}/admin/sign-in, then open the link the emulator prints here:`)
  const logins = [{ label: 'Superadmin', email: SUPERADMIN_EMAIL }, ...ADMIN_USERS.map(({ label, user }) => ({ label, email: user.email }))]
  for (const { label, email } of logins) console.log(`  ${`${label}:`.padEnd(16)}${email}`)
}

// A reseed mints a new brigadeId, so the users are rewritten then; otherwise any edits to them stay.
async function writeMissingAdminUsers(db: Firestore, reseeded: boolean): Promise<void> {
  for (const { user } of ADMIN_USERS) {
    if (reseeded || !(await db.collection('adminUsers').doc(user.email).get()).exists) {
      await writeAdminUser(db, user)
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

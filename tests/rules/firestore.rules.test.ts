import { readFileSync } from 'node:fs'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import firebase from 'firebase/compat/app'
import { afterAll, beforeAll, describe, it } from 'vitest'

let testEnv: RulesTestEnvironment

const BRIGADE_PATH = 'brigades/abc123'
const SETTINGS_PATH = `${BRIGADE_PATH}/private/settings`
const APPLIANCE_PATH = `${BRIGADE_PATH}/appliances/8011`
const VERSION_PATH = `${APPLIANCE_PATH}/checkSheetVersions/1`
const CHECK_PATH = `${BRIGADE_PATH}/checks/8011_2026-03-01`

function unauthedDb(): firebase.firestore.Firestore {
  return testEnv.unauthenticatedContext().firestore()
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-appliance-checks',
    firestore: {
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
  })

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await db.doc(BRIGADE_PATH).set({ brigadeId: 'b1', name: 'Test Brigade', checkDay: 1, active: true })
    await db.doc(SETTINGS_PATH).set({ reportEmail: 'vso@example.com' })
    await db.doc(APPLIANCE_PATH).set({ callsign: 'Test 8011', active: true, currentCheckSheetVersion: 1 })
    await db.doc(VERSION_PATH).set({ version: 1, sections: [] })
    await db.doc(CHECK_PATH).set({ applianceId: '8011' })
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

describe('firestore.rules', () => {
  it('allows an anonymous get on brigades/{slug}', async () => {
    await assertSucceeds(unauthedDb().doc(BRIGADE_PATH).get())
  })

  it('denies listing brigades', async () => {
    await assertFails(unauthedDb().collection('brigades').get())
  })

  it('denies getting brigades/{slug}/private/settings', async () => {
    await assertFails(unauthedDb().doc(SETTINGS_PATH).get())
  })

  it('allows get and list on brigades/{slug}/appliances', async () => {
    await assertSucceeds(unauthedDb().doc(APPLIANCE_PATH).get())
    await assertSucceeds(unauthedDb().collection(`${BRIGADE_PATH}/appliances`).get())
  })

  it('denies a collection group query on appliances', async () => {
    await assertFails(unauthedDb().collectionGroup('appliances').get())
  })

  it('allows get and list on checkSheetVersions', async () => {
    await assertSucceeds(unauthedDb().doc(VERSION_PATH).get())
    await assertSucceeds(unauthedDb().collection(`${APPLIANCE_PATH}/checkSheetVersions`).get())
  })

  it('denies getting a check', async () => {
    await assertFails(unauthedDb().doc(CHECK_PATH).get())
  })

  it.each([
    ['brigade', BRIGADE_PATH, { name: 'x' }],
    ['settings', SETTINGS_PATH, { reportEmail: 'x' }],
    ['appliance', APPLIANCE_PATH, { callsign: 'x' }],
    ['version', VERSION_PATH, { version: 2 }],
    ['check', CHECK_PATH, { applianceId: 'x' }],
  ])('denies writing to %s', async (_name, path, data) => {
    await assertFails(unauthedDb().doc(path).set(data))
  })
})

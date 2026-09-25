import { readFileSync } from 'node:fs'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import firebase from 'firebase/compat/app'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays, firstOfPreviousMonth, today } from '../../src/domain/schedule'
import { newId } from '../../src/domain/slug'

let testEnv: RulesTestEnvironment

const BRIGADE_PATH = 'brigades/abc123'
const SETTINGS_PATH = `${BRIGADE_PATH}/private/settings`
const APPLIANCE_PATH = `${BRIGADE_PATH}/appliances/8011`
const APPLIANCE_8012_PATH = `${BRIGADE_PATH}/appliances/8012`
const VERSION_PATH = `${APPLIANCE_PATH}/checkSheetVersions/1`

const TODAY = today()
const CHECK_PATH = `${BRIGADE_PATH}/checks/8011_${TODAY}`

const UTC_TODAY = new Date().toISOString().slice(0, 10)
const TOO_EARLY = addDays(firstOfPreviousMonth(UTC_TODAY), -1)
const TOO_LATE = addDays(UTC_TODAY, 3)
const BASE_DATE = addDays(TODAY, -3)

const CAB_ID = 'cab22222'
const TCH_ID = 'tch22222'

function unauthedDb(): firebase.firestore.Firestore {
  return testEnv.unauthenticatedContext().firestore()
}

function checkData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    applianceId: '8011',
    scheduledDate: BASE_DATE,
    monthly: false,
    checkSheetVersion: 1,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    responses: { [CAB_ID]: 'Y' },
    ...overrides,
  }
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
    await db.doc(APPLIANCE_PATH).set({ callsign: 'Test 8011', active: true, currentCheckSheetVersion: 2 })
    await db.doc(APPLIANCE_8012_PATH).set({ callsign: 'Test 8012', active: true, currentCheckSheetVersion: 2 })
    await db.doc(VERSION_PATH).set({ version: 1, sections: [] })
    await db.doc(CHECK_PATH).set({
      applianceId: '8011',
      scheduledDate: TODAY,
      monthly: false,
      checkSheetVersion: 1,
      responses: {},
      updatedAt: new Date(),
    })
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

  it.each([
    ['brigade', BRIGADE_PATH, { name: 'x' }],
    ['settings', SETTINGS_PATH, { reportEmail: 'x' }],
    ['appliance', APPLIANCE_PATH, { callsign: 'x' }],
    ['version', VERSION_PATH, { version: 2 }],
  ])('denies writing to %s', async (_name, path, data) => {
    await assertFails(unauthedDb().doc(path).set(data))
  })

  it('allows getting a Check', async () => {
    await assertSucceeds(unauthedDb().doc(CHECK_PATH).get())
  })

  it('denies an unbounded list of Checks', async () => {
    await assertFails(unauthedDb().collection(`${BRIGADE_PATH}/checks`).get())
  })

  it('denies a list of Checks bounded too early', async () => {
    await assertFails(unauthedDb().collection(`${BRIGADE_PATH}/checks`).where('scheduledDate', '>=', '2000-01-01').get())
  })

  it('denies a collection-group query on checks even when bounded', async () => {
    await assertFails(
      unauthedDb().collectionGroup('checks').where('scheduledDate', '>=', firstOfPreviousMonth(TODAY)).get(),
    )
  })

  it('allows a bounded list scoped to one appliance', async () => {
    await assertSucceeds(
      unauthedDb()
        .collection(`${BRIGADE_PATH}/checks`)
        .where('applianceId', '==', '8011')
        .where('scheduledDate', '>=', firstOfPreviousMonth(TODAY))
        .orderBy('scheduledDate')
        .get(),
    )
  })

  it('denies deleting a Check', async () => {
    await assertFails(unauthedDb().doc(CHECK_PATH).delete())
  })

  it('creates, answers a second Item, clears an answer, and allows a version-only write', async () => {
    const date = addDays(TODAY, -7)
    const path = `${BRIGADE_PATH}/checks/8012_${date}`

    await assertSucceeds(
      unauthedDb()
        .doc(path)
        .set(checkData({ applianceId: '8012', scheduledDate: date, responses: { [CAB_ID]: 'Y' } }), { merge: true }),
    )
    await assertSucceeds(
      unauthedDb()
        .doc(path)
        .set(
          {
            checkSheetVersion: 1,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            responses: { [TCH_ID]: 'N' },
          },
          { merge: true },
        ),
    )
    await assertSucceeds(
      unauthedDb()
        .doc(path)
        .set(
          {
            checkSheetVersion: 1,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            responses: { [CAB_ID]: firebase.firestore.FieldValue.delete() },
          },
          { merge: true },
        ),
    )
    await assertSucceeds(
      unauthedDb()
        .doc(path)
        .set({ checkSheetVersion: 2, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }),
    )
  })

  it('lets two contexts answer different Items of a new Check concurrently', async () => {
    const date = addDays(TODAY, -8)
    const path = `${BRIGADE_PATH}/checks/8011_${date}`

    await Promise.all([
      assertSucceeds(
        unauthedDb()
          .doc(path)
          .set(checkData({ scheduledDate: date, responses: { [CAB_ID]: 'Y' } }), { merge: true }),
      ),
      assertSucceeds(
        unauthedDb()
          .doc(path)
          .set(checkData({ scheduledDate: date, responses: { [TCH_ID]: 'N' } }), { merge: true }),
      ),
    ])

    const doc = await unauthedDb().doc(path).get()
    expect(doc.data()?.responses).toEqual({ [CAB_ID]: 'Y', [TCH_ID]: 'N' })
  })

  it('denies a decreasing checkSheetVersion on update', async () => {
    const date = addDays(TODAY, -9)
    const path = `${BRIGADE_PATH}/checks/8011_${date}`

    await assertSucceeds(unauthedDb().doc(path).set(checkData({ scheduledDate: date, checkSheetVersion: 2 }), { merge: true }))
    await assertFails(
      unauthedDb()
        .doc(path)
        .set({ checkSheetVersion: 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }),
    )
  })

  it('denies a create with checkSheetVersion above the appliance current version', async () => {
    const date = addDays(TODAY, -13)
    const path = `${BRIGADE_PATH}/checks/8011_${date}`

    await assertFails(
      unauthedDb().doc(path).set(checkData({ scheduledDate: date, checkSheetVersion: 3 }), { merge: true }),
    )
  })

  it('denies raising checkSheetVersion above the appliance current version on update', async () => {
    const date = addDays(TODAY, -14)
    const path = `${BRIGADE_PATH}/checks/8011_${date}`

    await assertSucceeds(
      unauthedDb().doc(path).set(checkData({ scheduledDate: date, checkSheetVersion: 1 }), { merge: true }),
    )
    await assertFails(
      unauthedDb()
        .doc(path)
        .set({ checkSheetVersion: 3, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }),
    )
  })

  it('allows changing an existing answer to a different valid value', async () => {
    const date = addDays(TODAY, -15)
    const path = `${BRIGADE_PATH}/checks/8011_${date}`

    await assertSucceeds(unauthedDb().doc(path).set(checkData({ scheduledDate: date }), { merge: true }))
    await assertSucceeds(
      unauthedDb()
        .doc(path)
        .set(
          { checkSheetVersion: 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), responses: { [CAB_ID]: 'N' } },
          { merge: true },
        ),
    )
  })

  it('denies changing an existing answer to an invalid value', async () => {
    const date = addDays(TODAY, -12)
    const path = `${BRIGADE_PATH}/checks/8011_${date}`

    await assertSucceeds(unauthedDb().doc(path).set(checkData({ scheduledDate: date }), { merge: true }))
    await assertFails(
      unauthedDb()
        .doc(path)
        .set(
          {
            checkSheetVersion: 1,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            responses: { [CAB_ID]: 'x'.repeat(201) },
          },
          { merge: true },
        ),
    )
  })

  it('denies monthly changing on update', async () => {
    const date = addDays(TODAY, -10)
    const path = `${BRIGADE_PATH}/checks/8011_${date}`

    await assertSucceeds(unauthedDb().doc(path).set(checkData({ scheduledDate: date, monthly: false }), { merge: true }))
    await assertFails(
      unauthedDb()
        .doc(path)
        .set({ monthly: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }),
    )
  })

  it('denies a new key on a Check already holding 500', async () => {
    const date = addDays(TODAY, -11)
    const path = `${BRIGADE_PATH}/checks/8011_${date}`
    const ids = new Set<string>()
    while (ids.size < 500) ids.add(newId())
    const responses = Object.fromEntries([...ids].map((id) => [id, 'Y']))

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(path).set({
        applianceId: '8011',
        scheduledDate: date,
        monthly: false,
        checkSheetVersion: 1,
        responses,
        updatedAt: new Date(),
      })
    })

    await assertFails(
      unauthedDb()
        .doc(path)
        .set(
          {
            checkSheetVersion: 1,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            responses: { [newId()]: 'Y' },
          },
          { merge: true },
        ),
    )
  })

  it.each([
    ['an extra key', `8011_${BASE_DATE}`, checkData({ extra: 'x' })],
    [
      'a missing key',
      `8011_${BASE_DATE}`,
      {
        applianceId: '8011',
        scheduledDate: BASE_DATE,
        checkSheetVersion: 1,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        responses: { [CAB_ID]: 'Y' },
      },
    ],
    [
      'a doc id whose date does not match scheduledDate',
      `8011_${addDays(BASE_DATE, -1)}`,
      checkData({ scheduledDate: BASE_DATE }),
    ],
    ['two responses in one write', `8011_${BASE_DATE}`, checkData({ responses: { [CAB_ID]: 'Y', [TCH_ID]: 'N' } })],
    ['a number value', `8011_${BASE_DATE}`, checkData({ responses: { [CAB_ID]: 5 } })],
    ['an empty string', `8011_${BASE_DATE}`, checkData({ responses: { [CAB_ID]: '' } })],
    ['a 201-char string', `8011_${BASE_DATE}`, checkData({ responses: { [CAB_ID]: 'x'.repeat(201) } })],
    ['a key not matching the Item id pattern', `8011_${BASE_DATE}`, checkData({ responses: { 'bad-key!': 'Y' } })],
    ['scheduledDate the day before the rules window', `8011_${TOO_EARLY}`, checkData({ scheduledDate: TOO_EARLY })],
    ['scheduledDate 3 days after UTC today', `8011_${TOO_LATE}`, checkData({ scheduledDate: TOO_LATE })],
    ["scheduledDate '2026-9-1'", '8011_2026-9-1', checkData({ scheduledDate: '2026-9-1' })],
    [
      'scheduledDate with a trailing character that fails the format regex',
      `8011_${BASE_DATE}x`,
      checkData({ scheduledDate: `${BASE_DATE}x` }),
    ],
    ['checkSheetVersion 0', `8011_${BASE_DATE}`, checkData({ checkSheetVersion: 0 })],
    ['checkSheetVersion 1.5', `8011_${BASE_DATE}`, checkData({ checkSheetVersion: 1.5 })],
    ['updatedAt a client Date', `8011_${BASE_DATE}`, checkData({ updatedAt: new Date() })],
    ['create for an appliance that does not exist', `9999_${BASE_DATE}`, checkData({ applianceId: '9999' })],
  ])('denies %s', async (_name, checkId, data) => {
    await assertFails(unauthedDb().doc(`${BRIGADE_PATH}/checks/${checkId}`).set(data, { merge: true }))
  })
})

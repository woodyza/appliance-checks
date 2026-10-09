import { readFileSync } from 'node:fs'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import firebase from 'firebase/compat/app'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addDays, EARLY_DAYS, firstOfPreviousMonth, today } from '../../src/domain/schedule'
import { newId } from '../../src/domain/slug'

let testEnv: RulesTestEnvironment

const BRIGADE_PATH = 'brigades/abc123'
const OTHER_BRIGADE_PATH = 'brigades/def456'
const SETTINGS_PATH = `${BRIGADE_PATH}/private/settings`
const APPLIANCE_PATH = `${BRIGADE_PATH}/appliances/8011`
const APPLIANCE_8012_PATH = `${BRIGADE_PATH}/appliances/8012`
const VERSION_PATH = `${APPLIANCE_PATH}/checkSheetVersions/1`
const SUPERADMIN_CONFIG_PATH = 'deployConfig/superadmin'

const TODAY = today()
const CHECK_PATH = `${BRIGADE_PATH}/checks/8011_${TODAY}`

const UTC_TODAY = new Date().toISOString().slice(0, 10)
const TOO_EARLY = addDays(firstOfPreviousMonth(UTC_TODAY), -1)
const TOO_LATE = addDays(UTC_TODAY, 4)
const BASE_DATE = addDays(TODAY, -3)

const CAB_ID = 'cab22222'
const TCH_ID = 'tch22222'

const OLD_CHECK_DATE = '2000-01-03'
const OLD_CHECK_PATH = `${BRIGADE_PATH}/checks/8011_${OLD_CHECK_DATE}`

function unauthedDb(): firebase.firestore.Firestore {
  return testEnv.unauthenticatedContext().firestore()
}

function superadminDb(): firebase.firestore.Firestore {
  return testEnv.authenticatedContext('emulator-superadmin').firestore()
}

function otherUserDb(): firebase.firestore.Firestore {
  return testEnv.authenticatedContext('some-other-uid').firestore()
}

function adminDb(email: string, verified = true): firebase.firestore.Firestore {
  return testEnv.authenticatedContext(email, { email, email_verified: verified }).firestore()
}

function oldChecksList(
  db: firebase.firestore.Firestore,
  brigadePath: string,
): Promise<firebase.firestore.QuerySnapshot> {
  return db
    .collection(`${brigadePath}/checks`)
    .where('applianceId', '==', '8011')
    .where('scheduledDate', '>=', '2000-01-01')
    .where('scheduledDate', '<', firstOfPreviousMonth(TODAY))
    .orderBy('scheduledDate')
    .get()
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
    await db.doc(OLD_CHECK_PATH).set({
      applianceId: '8011',
      scheduledDate: OLD_CHECK_DATE,
      monthly: false,
      checkSheetVersion: 1,
      responses: {},
      updatedAt: new Date(),
    })
    await db.doc(OTHER_BRIGADE_PATH).set({ brigadeId: 'b2', name: 'Other Brigade', checkDay: 1, active: true })
    await db.doc('adminUsers/jo@example.com').set({
      email: 'jo@example.com',
      displayName: null,
      role: 'brigadeAdmin',
      brigadeIds: ['b1'],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    })
    await db.doc('adminUsers/sam@example.com').set({
      email: 'sam@example.com',
      displayName: null,
      role: 'vso',
      brigadeIds: ['b2'],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    })
    await db.doc(SUPERADMIN_CONFIG_PATH).set({ uid: 'emulator-superadmin', email: 'root@example.com' })
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

  it('allows starting a Check dated 2 days from today', async () => {
    const date = addDays(TODAY, EARLY_DAYS)

    await assertSucceeds(
      unauthedDb()
        .doc(`${BRIGADE_PATH}/checks/8011_${date}`)
        .set(checkData({ scheduledDate: date }), { merge: true }),
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
    ['scheduledDate 4 days after UTC today', `8011_${TOO_LATE}`, checkData({ scheduledDate: TOO_LATE })],
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

describe('superadmin', () => {
  it('allows listing brigades', async () => {
    await assertSucceeds(superadminDb().collection('brigades').get())
  })

  it('allows a checks list bounded before firstOfPreviousMonth', async () => {
    await assertSucceeds(oldChecksList(superadminDb(), BRIGADE_PATH))
  })

  it('allows getting an old Check', async () => {
    await assertSucceeds(superadminDb().doc(OLD_CHECK_PATH).get())
  })

  it.each([
    ['appliance', APPLIANCE_PATH, { callsign: 'x' }],
    ['version', VERSION_PATH, { version: 2 }],
  ])('denies writing to %s', async (_name, path, data) => {
    await assertFails(superadminDb().doc(path).set(data))
  })
})

describe('deployConfig/superadmin', () => {
  it.each([
    ['unauthenticated', unauthedDb],
    ['another signed-in user', otherUserDb],
    ['the superadmin', superadminDb],
  ])('denies get to %s', async (_name, dbFor) => {
    await assertFails(dbFor().doc(SUPERADMIN_CONFIG_PATH).get())
  })

  it('denies set to the superadmin', async () => {
    await assertFails(superadminDb().doc(SUPERADMIN_CONFIG_PATH).set({ uid: 'someone-else' }))
  })
})

describe('another signed-in user', () => {
  it('denies listing brigades', async () => {
    await assertFails(otherUserDb().collection('brigades').get())
  })

  it('denies a checks list bounded before firstOfPreviousMonth', async () => {
    await assertFails(oldChecksList(otherUserDb(), BRIGADE_PATH))
  })
})

describe('admin users', () => {
  it("allows a mixed-case token email to get its own lower-cased doc", async () => {
    await assertSucceeds(adminDb('Jo@Example.com').doc('adminUsers/jo@example.com').get())
  })

  it('denies get when the token email is unverified', async () => {
    await assertFails(adminDb('jo@example.com', false).doc('adminUsers/jo@example.com').get())
  })

  it("denies one admin getting another admin's doc", async () => {
    await assertFails(adminDb('sam@example.com').doc('adminUsers/jo@example.com').get())
  })

  it('allows the superadmin to get and list adminUsers, denies an admin listing them', async () => {
    await assertSucceeds(superadminDb().doc('adminUsers/jo@example.com').get())
    await assertSucceeds(superadminDb().collection('adminUsers').get())
    await assertFails(adminDb('jo@example.com').collection('adminUsers').get())
  })

  it('allows the superadmin to create and then delete an adminUsers doc', async () => {
    const ref = superadminDb().doc('adminUsers/new@example.com')
    await assertSucceeds(
      ref.set({ email: 'new@example.com', displayName: null, role: 'vso', brigadeIds: ['b1'] }),
    )
    await assertSucceeds(ref.delete())
  })

  it('denies a create whose doc id is not already lower-case', async () => {
    await assertFails(
      superadminDb()
        .doc('adminUsers/New@example.com')
        .set({ email: 'New@example.com', displayName: null, role: 'vso', brigadeIds: ['b1'] }),
    )
  })

  it("denies a create whose email field doesn't match the doc id", async () => {
    await assertFails(
      superadminDb()
        .doc('adminUsers/new2@example.com')
        .set({ email: 'other@example.com', displayName: null, role: 'vso', brigadeIds: ['b1'] }),
    )
  })

  it('denies an admin updating their own doc', async () => {
    await assertFails(
      adminDb('jo@example.com')
        .doc('adminUsers/jo@example.com')
        .set({ brigadeIds: ['b1', 'b2'] }, { merge: true }),
    )
  })
})

describe('brigade admin', () => {
  it("allows an old-bounded checks list for the admin's assigned brigade", async () => {
    await assertSucceeds(oldChecksList(adminDb('jo@example.com'), BRIGADE_PATH))
  })

  it('denies an old-bounded checks list for an unassigned brigade', async () => {
    await assertFails(oldChecksList(adminDb('jo@example.com'), OTHER_BRIGADE_PATH))
  })

  it('denies an old-bounded checks list when the token email is unverified', async () => {
    await assertFails(oldChecksList(adminDb('jo@example.com', false), BRIGADE_PATH))
  })

  it("allows a brigades list bounded to the admin's own brigadeId", async () => {
    await assertSucceeds(adminDb('jo@example.com').collection('brigades').where('brigadeId', 'in', ['b1']).get())
  })

  it('denies a brigades list that includes an unassigned brigadeId', async () => {
    await assertFails(
      adminDb('jo@example.com').collection('brigades').where('brigadeId', 'in', ['b1', 'b2']).get(),
    )
  })

  it('denies an unfiltered brigades list', async () => {
    await assertFails(adminDb('jo@example.com').collection('brigades').get())
  })
})

describe('check sheet editor', () => {
  const EMPTY_PATH = `${BRIGADE_PATH}/appliances/8020`
  const SHEETED_PATH = `${BRIGADE_PATH}/appliances/8021`
  const DRAFT_PATH = `${SHEETED_PATH}/private/checkSheetDraft`
  const EMPTY_DRAFT_PATH = `${EMPTY_PATH}/private/checkSheetDraft`
  const NEW_APPLIANCE = { callsign: 'New 1', active: true, currentCheckSheetVersion: null }
  const DRAFT = { baseVersion: 1, origin: { type: 'editor' }, sections: [] }

  function jo(): firebase.firestore.Firestore {
    return adminDb('jo@example.com')
  }

  function sam(): firebase.firestore.Firestore {
    return adminDb('sam@example.com')
  }

  function versionData(version: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      origin: { type: 'editor' },
      sections: [],
      ...overrides,
    }
  }

  function publish(
    db: firebase.firestore.Firestore,
    appliancePath: string,
    version: number,
    options: { data?: Record<string, unknown>; pointer?: number } = {},
  ): Promise<void> {
    const batch = db.batch()
    batch.set(
      db.doc(`${appliancePath}/checkSheetVersions/${String(version)}`),
      options.data ?? versionData(version),
    )
    batch.update(db.doc(appliancePath), { currentCheckSheetVersion: options.pointer ?? version })
    batch.delete(db.doc(`${appliancePath}/private/checkSheetDraft`))
    return batch.commit()
  }

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await db.doc(`${EMPTY_PATH}/checkSheetVersions/1`).delete()
      await db.doc(`${SHEETED_PATH}/checkSheetVersions/2`).delete()
      await db.doc(`${SHEETED_PATH}/checkSheetVersions/3`).delete()
      await db.doc(EMPTY_PATH).set({ callsign: 'Test 8020', active: true, currentCheckSheetVersion: null })
      await db.doc(SHEETED_PATH).set({ callsign: 'Test 8021', active: true, currentCheckSheetVersion: 1 })
      await db.doc(`${SHEETED_PATH}/checkSheetVersions/1`).set({ version: 1, sections: [] })
      await db.doc(DRAFT_PATH).set(DRAFT)
      await db.doc(EMPTY_DRAFT_PATH).set({ ...DRAFT, baseVersion: null })
      await db.doc(`${SHEETED_PATH}/private/other`).set({ x: 1 })
    })
  })

  it('allows the superadmin and an assigned admin to create an appliance', async () => {
    await assertSucceeds(superadminDb().doc(`${BRIGADE_PATH}/appliances/new1`).set(NEW_APPLIANCE))
    await assertSucceeds(jo().doc(`${BRIGADE_PATH}/appliances/new2`).set(NEW_APPLIANCE))
  })

  it.each([
    ['an extra key', 'new3', { ...NEW_APPLIANCE, extra: 1 }],
    ['an id with a space', 'a b', NEW_APPLIANCE],
    ['the id admin', 'admin', NEW_APPLIANCE],
    ['active false', 'new3', { ...NEW_APPLIANCE, active: false }],
    ['a non-null pointer', 'new3', { ...NEW_APPLIANCE, currentCheckSheetVersion: 1 }],
    ['an empty callsign', 'new3', { ...NEW_APPLIANCE, callsign: '' }],
    ['a 61-character callsign', 'new3', { ...NEW_APPLIANCE, callsign: 'x'.repeat(61) }],
  ])('denies creating an appliance with %s', async (_name, id, data) => {
    await assertFails(jo().doc(`${BRIGADE_PATH}/appliances/${id}`).set(data))
  })

  it('denies creating an appliance as an unassigned admin and as anonymous', async () => {
    await assertFails(sam().doc(`${BRIGADE_PATH}/appliances/new3`).set(NEW_APPLIANCE))
    await assertFails(unauthedDb().doc(`${BRIGADE_PATH}/appliances/new3`).set(NEW_APPLIANCE))
  })

  it('allows an assigned admin to rename and deactivate an appliance', async () => {
    await assertSucceeds(jo().doc(SHEETED_PATH).update({ callsign: 'Renamed' }))
    await assertSucceeds(jo().doc(SHEETED_PATH).update({ active: false }))
  })

  it.each([
    ['an extra key', { extra: 1 }],
    ['a 61-character callsign', { callsign: 'x'.repeat(61) }],
  ])('denies updating an appliance with %s', async (_name, data) => {
    await assertFails(jo().doc(SHEETED_PATH).update(data))
  })

  it.each([
    ['an existing Check Sheet', SHEETED_PATH, 2],
    ['no Check Sheet yet', EMPTY_PATH, 1],
  ])('allows Publish (version, pointer and draft delete in one batch) with %s', async (_name, path, version) => {
    await assertSucceeds(publish(jo(), path, version))
  })

  it('denies the version create alone', async () => {
    await assertFails(jo().doc(`${SHEETED_PATH}/checkSheetVersions/2`).set(versionData(2)))
  })

  it('denies the pointer update alone', async () => {
    await assertFails(jo().doc(SHEETED_PATH).update({ currentCheckSheetVersion: 2 }))
  })

  it.each<[string, Parameters<typeof publish>[3], number]>([
    ['a pointer jump from 1 to 3', {}, 3],
    ['an origin type other', { data: versionData(2, { origin: { type: 'other' } }) }, 2],
    ['an extra key', { data: versionData(2, { extra: 1 }) }, 2],
    ['a client createdAt', { data: versionData(2, { createdAt: new Date() }) }, 2],
  ])('denies Publish with %s', async (_name, options, version) => {
    await assertFails(publish(jo(), SHEETED_PATH, version, options))
  })

  it('denies a stray version whose doc id differs from its version alongside a valid Publish', async () => {
    const db = jo()
    const batch = db.batch()
    batch.set(db.doc(`${SHEETED_PATH}/checkSheetVersions/2`), versionData(2))
    batch.set(db.doc(`${SHEETED_PATH}/checkSheetVersions/3`), versionData(2))
    batch.update(db.doc(SHEETED_PATH), { currentCheckSheetVersion: 2 })

    await assertFails(batch.commit())
  })

  it('denies Publish as an unassigned admin', async () => {
    await assertFails(publish(sam(), SHEETED_PATH, 2))
  })

  it('denies updating and deleting a version, even as the superadmin', async () => {
    const ref = superadminDb().doc(`${SHEETED_PATH}/checkSheetVersions/1`)

    await assertFails(ref.update({ version: 1 }))
    await assertFails(ref.delete())
  })

  it('lets an assigned admin create, read, update and delete the draft', async () => {
    const ref = jo().doc(DRAFT_PATH)

    await assertSucceeds(ref.get())
    await assertSucceeds(ref.set({ ...DRAFT, baseVersion: 1 }))
    await assertSucceeds(ref.delete())
    await assertSucceeds(ref.set(DRAFT))
  })

  it('denies a draft with an extra key', async () => {
    await assertFails(jo().doc(DRAFT_PATH).set({ ...DRAFT, extra: 1 }))
  })

  it('denies an unassigned admin and anonymous from reading or writing the draft', async () => {
    for (const db of [sam(), unauthedDb()]) {
      await assertFails(db.doc(DRAFT_PATH).get())
      await assertFails(db.doc(DRAFT_PATH).set(DRAFT))
    }
  })

  it('denies reading and writing other private docs as an assigned admin', async () => {
    await assertFails(jo().doc(`${SHEETED_PATH}/private/other`).get())
    await assertFails(jo().doc(`${SHEETED_PATH}/private/other`).set({ x: 2 }))
  })
})

describe('brigade details', () => {
  const NEW_PATH = 'brigades/n3wbrg'
  const EDIT_PATH = 'brigades/edt234'
  const EDIT_SETTINGS_PATH = `${EDIT_PATH}/private/settings`
  const EDIT_MONTHLY_REPORT_PATH = `${EDIT_PATH}/private/monthlyReport`
  const EDIT_MONTHLY_REPORT_SENT_PATH = `${EDIT_PATH}/private/monthlyReportSent`
  const NEW_BRIGADE = { brigadeId: 'b9', name: 'New Brigade', checkDay: 3, active: true }
  const EDIT_BRIGADE = { brigadeId: 'b1', name: 'Edit Brigade', checkDay: 1, active: true }

  function jo(): firebase.firestore.Firestore {
    return adminDb('jo@example.com')
  }

  function sam(): firebase.firestore.Firestore {
    return adminDb('sam@example.com')
  }

  // A VSO assigned to the same brigade as jo, the Brigade Admin.
  function vic(): firebase.firestore.Firestore {
    return adminDb('vic@example.com')
  }

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await db.doc('adminUsers/vic@example.com').set({
        email: 'vic@example.com',
        displayName: null,
        role: 'vso',
        brigadeIds: ['b1'],
      })
      await db.doc(NEW_PATH).delete()
      await db.doc(`${NEW_PATH}/private/settings`).delete()
      await db.doc(EDIT_PATH).set(EDIT_BRIGADE)
      await db.doc(EDIT_SETTINGS_PATH).set({ reportEmail: 'team@example.com' })
    })
  })

  it('allows the superadmin to create a brigade and its settings together', async () => {
    const db = superadminDb()
    const batch = db.batch()
    batch.set(db.doc(NEW_PATH), NEW_BRIGADE)
    batch.set(db.doc(`${NEW_PATH}/private/settings`), { weeklyEmail: true })
    await assertSucceeds(batch.commit())
  })

  it('denies an assigned admin creating a brigade', async () => {
    await assertFails(jo().doc(NEW_PATH).set({ ...NEW_BRIGADE, brigadeId: 'b1' }))
  })

  it.each([
    ['active false', NEW_PATH, { ...NEW_BRIGADE, active: false }],
    ['an extra key', NEW_PATH, { ...NEW_BRIGADE, extra: 1 }],
    ['a Check Day of 8', NEW_PATH, { ...NEW_BRIGADE, checkDay: 8 }],
    ['an empty name', NEW_PATH, { ...NEW_BRIGADE, name: '' }],
    ['a slug outside the slug pattern', 'brigades/ABC123', NEW_BRIGADE],
  ])('denies the superadmin creating a brigade with %s', async (_name, path, data) => {
    await assertFails(superadminDb().doc(path).set(data))
  })

  it("allows an assigned admin to change the brigade's name and Check Day", async () => {
    await assertSucceeds(jo().doc(EDIT_PATH).update({ name: 'Renamed', checkDay: 5 }))
  })

  it.each([
    ['a Check Day of 0', { checkDay: 0 }],
    ['an empty name', { name: '' }],
    ['an extra key', { extra: 1 }],
  ])('denies the superadmin updating a brigade with %s', async (_name, data) => {
    await assertFails(superadminDb().doc(EDIT_PATH).update(data))
  })

  it('denies an unassigned admin updating the brigade', async () => {
    await assertFails(sam().doc(EDIT_PATH).update({ name: 'Renamed' }))
  })

  it('denies an assigned admin deactivating the brigade, but allows the superadmin', async () => {
    await assertFails(jo().doc(EDIT_PATH).update({ active: false }))
    await assertSucceeds(superadminDb().doc(EDIT_PATH).update({ active: false }))
  })

  it("denies changing a brigade's brigadeId, even as the superadmin", async () => {
    await assertFails(superadminDb().doc(EDIT_PATH).update({ brigadeId: 'b2' }))
  })

  it('denies deleting a brigade, even as the superadmin', async () => {
    await assertFails(superadminDb().doc(EDIT_PATH).delete())
  })

  it('allows an assigned VSO to read and write the settings', async () => {
    await assertSucceeds(vic().doc(EDIT_SETTINGS_PATH).get())
    await assertSucceeds(vic().doc(EDIT_SETTINGS_PATH).set({ reportEmail: 'new@example.com', weeklyEmail: false }))
  })

  it("denies the brigade's Brigade Admin reading or writing the settings", async () => {
    await assertFails(jo().doc(EDIT_SETTINGS_PATH).get())
    await assertFails(jo().doc(EDIT_SETTINGS_PATH).set({ weeklyEmail: false }))
  })

  it('allows an assigned VSO to clear the Report Email', async () => {
    await assertSucceeds(
      vic()
        .doc(EDIT_SETTINGS_PATH)
        .set({ reportEmail: firebase.firestore.FieldValue.delete(), weeklyEmail: true }, { merge: true }),
    )
  })

  it('denies an unassigned VSO reading or writing the settings', async () => {
    await assertFails(sam().doc(EDIT_SETTINGS_PATH).get())
    await assertFails(sam().doc(EDIT_SETTINGS_PATH).set({ weeklyEmail: false }))
  })

  it.each([
    ['an extra key', { weeklyEmail: true, extra: 1 }],
    ['a non-boolean weeklyEmail', { weeklyEmail: 'yes' }],
    ['a non-string reportEmail', { reportEmail: 1 }],
    ['a reportEmail over 254 characters', { reportEmail: `${'x'.repeat(250)}@a.nz` }],
  ])('denies settings with %s', async (_name, data) => {
    await assertFails(vic().doc(EDIT_SETTINGS_PATH).set(data))
  })

  it('allows the brigade\'s Brigade Admin to set and get the Monthly Report email', async () => {
    await assertSucceeds(jo().doc(EDIT_MONTHLY_REPORT_PATH).set({ enabled: true, email: 'x@example.com' }))
    await assertSucceeds(jo().doc(EDIT_MONTHLY_REPORT_PATH).get())
  })

  it('denies an anonymous get of the Monthly Report email', async () => {
    await assertFails(unauthedDb().doc(EDIT_MONTHLY_REPORT_PATH).get())
  })

  it('denies an admin of another brigade getting the Monthly Report email', async () => {
    await assertFails(sam().doc(EDIT_MONTHLY_REPORT_PATH).get())
  })

  it.each([
    ['enabled without an address', { enabled: true, email: '' }],
    ['an extra key', { enabled: false, email: '', extra: 1 }],
  ])('denies the Monthly Report email with %s', async (_name, data) => {
    await assertFails(jo().doc(EDIT_MONTHLY_REPORT_PATH).set(data))
  })

  it('denies a Brigade Admin getting or setting the Monthly Report sent marker', async () => {
    await assertFails(jo().doc(EDIT_MONTHLY_REPORT_SENT_PATH).get())
    await assertFails(jo().doc(EDIT_MONTHLY_REPORT_SENT_PATH).set({ month: '2026-09' }))
  })
})

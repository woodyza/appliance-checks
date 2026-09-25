import type { Firestore } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it } from 'vitest'
import { addAppliance, createBrigade, getCurrentVersion, writeVersion } from '../../cli/lib/store'
import { resolveTarget } from '../../cli/lib/target'
import { reconcile } from '../../src/domain/import/reconcile'
import type { ParsedCheckSheet, Section } from '../../src/domain/types'

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const PROJECT_ID = 'demo-appliance-checks'

async function clearFirestore(): Promise<void> {
  await fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: 'DELETE',
  })
}

let db: Firestore

beforeEach(async () => {
  db = await resolveTarget('emulator')
  await clearFirestore()
})

describe('createBrigade', () => {
  it('creates a brigade doc with a generated brigadeId and a private/settings doc', async () => {
    const { slug, brigadeId } = await createBrigade(db, { name: 'Test Brigade', checkDay: 1 })

    const brigadeSnapshot = await db.collection('brigades').doc(slug).get()
    expect(brigadeSnapshot.data()).toMatchObject({ brigadeId, name: 'Test Brigade', checkDay: 1, active: true })

    const settingsSnapshot = await db.collection('brigades').doc(slug).collection('private').doc('settings').get()
    expect(settingsSnapshot.exists).toBe(true)
  })

  it('retries with a new slug when the first slug returned is already taken', async () => {
    await db
      .collection('brigades')
      .doc('taken')
      .create({ brigadeId: 'existing', name: 'Existing Brigade', checkDay: 1, active: true })
    let calls = 0
    const makeSlug = (): string => (calls++ === 0 ? 'taken' : 'free')

    const { slug } = await createBrigade(db, { name: 'New Brigade', checkDay: 2 }, makeSlug)

    expect(slug).toBe('free')
  })
})

describe('addAppliance', () => {
  it('fails when the appliance id is already taken', async () => {
    const { slug } = await createBrigade(db, { name: 'Test Brigade', checkDay: 1 })
    await addAppliance(db, slug, { id: '8011', callsign: 'Test 8011' })

    await expect(addAppliance(db, slug, { id: '8011', callsign: 'Other' })).rejects.toThrow(/already taken/)
  })

  it('fails when the brigade does not exist', async () => {
    await expect(addAppliance(db, 'unknown-slug', { id: '8011', callsign: 'Test 8011' })).rejects.toThrow(
      /No brigade/,
    )
  })
})

describe('writeVersion', () => {
  it('creates version 1 and moves the pointer when expectedCurrent is null, then version 2 on the next write', async () => {
    const { slug } = await createBrigade(db, { name: 'Test Brigade', checkDay: 1 })
    await addAppliance(db, slug, { id: '8011', callsign: 'Test 8011' })
    const applianceRef = db.collection('brigades').doc(slug).collection('appliances').doc('8011')

    const v1 = await writeVersion(db, slug, '8011', {
      expectedCurrent: null,
      sections: [],
      origin: { type: 'editor' },
    })
    expect(v1).toBe(1)
    expect((await applianceRef.get()).data()?.currentCheckSheetVersion).toBe(1)

    const v2 = await writeVersion(db, slug, '8011', {
      expectedCurrent: 1,
      sections: [],
      origin: { type: 'editor' },
    })
    expect(v2).toBe(2)
    expect((await applianceRef.get()).data()?.currentCheckSheetVersion).toBe(2)

    const version1Snapshot = await applianceRef.collection('checkSheetVersions').doc('1').get()
    expect(version1Snapshot.data()).toMatchObject({ version: 1 })
  })

  it('throws and writes nothing when expectedCurrent is stale', async () => {
    const { slug } = await createBrigade(db, { name: 'Test Brigade', checkDay: 1 })
    await addAppliance(db, slug, { id: '8011', callsign: 'Test 8011' })
    await writeVersion(db, slug, '8011', { expectedCurrent: null, sections: [], origin: { type: 'editor' } })

    // expectedCurrent: 2 is stale (actual current is 1). Without the guard this would happily
    // create version 3 and move the pointer there, so it must not collide with an existing doc.
    await expect(
      writeVersion(db, slug, '8011', { expectedCurrent: 2, sections: [], origin: { type: 'editor' } }),
    ).rejects.toThrow()

    const applianceSnapshot = await db.collection('brigades').doc(slug).collection('appliances').doc('8011').get()
    expect(applianceSnapshot.data()?.currentCheckSheetVersion).toBe(1)
    const version3Snapshot = await db
      .collection('brigades')
      .doc(slug)
      .collection('appliances')
      .doc('8011')
      .collection('checkSheetVersions')
      .doc('3')
      .get()
    expect(version3Snapshot.exists).toBe(false)
  })
})

describe('getCurrentVersion', () => {
  it('round-trips a written version, with createdAt as a Date and content that reconciles as unchanged', async () => {
    const { slug } = await createBrigade(db, { name: 'Test Brigade', checkDay: 1 })
    await addAppliance(db, slug, { id: '8011', callsign: 'Test 8011' })
    const sections: Section[] = [
      { id: 's1', title: 'Cab', items: [{ id: 'i1', label: 'Torch', qty: '1', inputType: 'yn', scope: 'weekly' }] },
    ]
    await writeVersion(db, slug, '8011', { expectedCurrent: null, sections, origin: { type: 'editor' } })

    const current = await getCurrentVersion(db, slug, '8011')

    expect(current?.createdAt).toBeInstanceOf(Date)
    const parsed: ParsedCheckSheet = {
      sections: [{ title: 'Cab', items: [{ label: 'Torch', qty: '1', inputType: 'yn', scope: 'weekly' }] }],
    }
    expect(reconcile(current?.sections ?? null, parsed).unchanged).toBe(true)
  })
})

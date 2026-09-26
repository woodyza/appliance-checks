import { randomUUID } from 'node:crypto'
import type { Auth } from 'firebase-admin/auth'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import {
  addDays,
  checkDatesBetween,
  currentCheckDate,
  firstOfMonth,
  firstOfPreviousMonth,
  isLastOfMonth,
  today,
  weekday,
} from '../../src/domain/schedule'
import { newId } from '../../src/domain/slug'
import type { Section } from '../../src/domain/types'
import { EMULATOR_SUPERADMIN_UID } from './rules'

export const SUPERADMIN_EMAIL = 'e2e-admin@example.com'

/** Creates the emulator's fixed-UID superadmin user (see `firestore.rules`), skipping if it exists. */
export async function ensureSuperadminUser(auth: Auth): Promise<void> {
  try {
    await auth.getUser(EMULATOR_SUPERADMIN_UID)
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error
    await auth.createUser({ uid: EMULATOR_SUPERADMIN_UID, email: SUPERADMIN_EMAIL })
  }
}

export interface FixtureItemIds {
  torch: string
  radio: string
  helmet: string
  fuel: string
  rego: string
  odometer: string
  ladder: string
}

export interface Fixture {
  sections: Section[]
  ids: FixtureItemIds
}

export function fixtureCheckSheet(): Fixture {
  const ids: FixtureItemIds = {
    torch: newId(),
    radio: newId(),
    helmet: newId(),
    fuel: newId(),
    rego: newId(),
    odometer: newId(),
    ladder: newId(),
  }
  const sections: Section[] = [
    {
      id: newId(),
      title: 'Cab',
      items: [
        { id: ids.torch, label: 'Torch', qty: '1', inputType: 'yn', scope: 'weekly' },
        { id: ids.radio, label: 'Radio', qty: null, inputType: 'yn', scope: 'weekly' },
        { id: ids.helmet, label: 'Helmet', qty: null, inputType: 'yn', scope: 'weekly' },
        {
          id: ids.fuel,
          label: 'Fuel',
          qty: null,
          inputType: 'choice',
          options: ['1/4', '1/2', '3/4', 'FULL'],
          scope: 'weekly',
        },
      ],
    },
    {
      id: newId(),
      title: 'Road user details',
      items: [
        { id: ids.rego, label: 'Rego expiry', qty: null, inputType: 'written', scope: 'weekly' },
        { id: ids.odometer, label: 'Odometer', qty: null, inputType: 'written', scope: 'weekly' },
      ],
    },
    {
      id: newId(),
      title: 'Monthly',
      items: [{ id: ids.ladder, label: 'Ladder', qty: null, inputType: 'yn', scope: 'monthly' }],
    },
  ]
  return { sections, ids }
}

export interface SeedBrigadeInput {
  slug: string
  name: string
  appliances: { id: string; callsign: string }[]
  sections: Section[]
}

// Check Day is today's weekday, so the current Check is today's.
export async function writeBrigade(db: Firestore, input: SeedBrigadeInput): Promise<void> {
  const brigadeRef = db.collection('brigades').doc(input.slug)
  await brigadeRef.set({ brigadeId: randomUUID(), name: input.name, checkDay: weekday(today()), active: true })
  await brigadeRef.collection('private').doc('settings').set({})

  for (const appliance of input.appliances) {
    const applianceRef = brigadeRef.collection('appliances').doc(appliance.id)
    await applianceRef.set({ callsign: appliance.callsign, active: true, currentCheckSheetVersion: 1 })
    await applianceRef.collection('checkSheetVersions').doc('1').set({
      version: 1,
      createdAt: FieldValue.serverTimestamp(),
      origin: { type: 'editor' },
      sections: input.sections,
    })
  }
}

export async function deleteChecks(db: Firestore, slug: string): Promise<void> {
  const collectionRef = db.collection('brigades').doc(slug).collection('checks')
  const snapshot = await collectionRef.get()
  if (snapshot.empty) return
  const batch = db.batch()
  for (const doc of snapshot.docs) batch.delete(doc.ref)
  await batch.commit()
}

// Overwrites the appliance and its versions (numbered 1…n, current is n), so re-seeding is safe.
export async function writeVersionedAppliance(
  db: Firestore,
  slug: string,
  appliance: { id: string; callsign: string },
  versions: Section[][],
): Promise<void> {
  const applianceRef = db.collection('brigades').doc(slug).collection('appliances').doc(appliance.id)
  await applianceRef.set({ callsign: appliance.callsign, active: true, currentCheckSheetVersion: versions.length })
  for (const [index, sections] of versions.entries()) {
    await applianceRef.collection('checkSheetVersions').doc(String(index + 1)).set({
      version: index + 1,
      createdAt: FieldValue.serverTimestamp(),
      origin: { type: 'editor' },
      sections,
    })
  }
}

export function previousCheckDate(): string {
  const date = today()
  return addDays(currentCheckDate(date, weekday(date)), -7)
}

export async function writeCheck(
  db: Firestore,
  slug: string,
  applianceId: string,
  scheduledDate: string,
  checkSheetVersion: number,
  responses: Record<string, string>,
): Promise<void> {
  await db
    .collection('brigades')
    .doc(slug)
    .collection('checks')
    .doc(`${applianceId}_${scheduledDate}`)
    .set({
      applianceId,
      scheduledDate,
      monthly: isLastOfMonth(scheduledDate),
      checkSheetVersion,
      responses,
      updatedAt: FieldValue.serverTimestamp(),
    })
}

export async function writePreviousCheck(
  db: Firestore,
  slug: string,
  applianceId: string,
  responses: Record<string, string>,
): Promise<void> {
  await writeCheck(db, slug, applianceId, previousCheckDate(), 1, responses)
}

export function completeResponses(ids: FixtureItemIds): Record<string, string> {
  return {
    [ids.torch]: 'Y',
    [ids.radio]: 'Y',
    [ids.helmet]: 'N',
    [ids.fuel]: 'FULL',
    [ids.rego]: '31/12/26',
    [ids.odometer]: '12345',
    [ids.ladder]: 'Y',
  }
}

/** The first two Check Days of the month before `today()`, for a Check Day of `checkDay`. */
export function firstTwoCheckDaysOfPreviousMonth(checkDay: number): [string, string] {
  const start = firstOfPreviousMonth(today())
  const end = addDays(firstOfMonth(today()), -1)
  const [first, second] = checkDatesBetween(start, end, checkDay)
  return [first, second]
}

export interface E2e3ItemIds extends FixtureItemIds {
  beacon: string
}

export interface E2e3Fixture {
  v1: Section[]
  v2: Section[]
  ids: E2e3ItemIds
}

// v2 drops the v1-only Radio and adds the v2-only Beacon, per the design's e2e3 fixture.
export function fixtureCheckSheetE2e3(): E2e3Fixture {
  const { sections: v1, ids: baseIds } = fixtureCheckSheet()
  const ids: E2e3ItemIds = { ...baseIds, beacon: newId() }
  const v2 = v1.map((section) =>
    section.title !== 'Cab'
      ? section
      : {
          ...section,
          items: [
            ...section.items.filter((item) => item.id !== ids.radio),
            { id: ids.beacon, label: 'Beacon', qty: null, inputType: 'yn' as const, scope: 'weekly' as const },
          ],
        },
  )
  return { v1, v2, ids }
}

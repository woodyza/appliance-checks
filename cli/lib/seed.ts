import { randomUUID } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { addDays, currentCheckDate, isLastOfMonth, today, weekday } from '../../src/domain/schedule'
import { newId } from '../../src/domain/slug'
import type { Section } from '../../src/domain/types'

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

export function previousCheckDate(): string {
  const date = today()
  return addDays(currentCheckDate(date, weekday(date)), -7)
}

export async function writePreviousCheck(
  db: Firestore,
  slug: string,
  applianceId: string,
  responses: Record<string, string>,
): Promise<void> {
  const scheduledDate = previousCheckDate()
  await db
    .collection('brigades')
    .doc(slug)
    .collection('checks')
    .doc(`${applianceId}_${scheduledDate}`)
    .set({
      applianceId,
      scheduledDate,
      monthly: isLastOfMonth(scheduledDate),
      checkSheetVersion: 1,
      responses,
      updatedAt: FieldValue.serverTimestamp(),
    })
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

import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import type { CollectionReference } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { addDays, currentCheckDate, isLastOfMonth, today, weekday } from '../src/domain/schedule'
import { newId } from '../src/domain/slug'
import type { Section } from '../src/domain/types'
import { parseProjectTarget, resolveTarget } from './lib/target'

const SLUG = 'e2etst'

async function deleteAllDocs(collectionRef: CollectionReference): Promise<void> {
  const snapshot = await collectionRef.get()
  if (snapshot.empty) return
  const batch = collectionRef.firestore.batch()
  for (const doc of snapshot.docs) batch.delete(doc.ref)
  await batch.commit()
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { project: { type: 'string' } } })
  if (values.project === 'prod') throw new Error('--project must not be prod.')
  const target = parseProjectTarget(values.project)
  const db = await resolveTarget(target)

  const checkDay = weekday(today())

  const torchId = newId()
  const radioId = newId()
  const helmetId = newId()
  const fuelId = newId()
  const regoId = newId()
  const odometerId = newId()
  const ladderId = newId()

  const sections: Section[] = [
    {
      id: newId(),
      title: 'Cab',
      items: [
        { id: torchId, label: 'Torch', qty: '1', inputType: 'yn', scope: 'weekly' },
        { id: radioId, label: 'Radio', qty: null, inputType: 'yn', scope: 'weekly' },
        { id: helmetId, label: 'Helmet', qty: null, inputType: 'yn', scope: 'weekly' },
        {
          id: fuelId,
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
        { id: regoId, label: 'Rego expiry', qty: null, inputType: 'written', scope: 'weekly' },
        { id: odometerId, label: 'Odometer', qty: null, inputType: 'written', scope: 'weekly' },
      ],
    },
    {
      id: newId(),
      title: 'Monthly',
      items: [{ id: ladderId, label: 'Ladder', qty: null, inputType: 'yn', scope: 'monthly' }],
    },
  ]

  const brigadeRef = db.collection('brigades').doc(SLUG)
  const settingsRef = brigadeRef.collection('private').doc('settings')
  await brigadeRef.set({ brigadeId: randomUUID(), name: 'E2E Test Brigade', checkDay, active: true })
  await settingsRef.set({})

  for (const [applianceId, callsign] of [
    ['e2e1', 'E2E 1'],
    ['e2e2', 'E2E 2'],
  ] as const) {
    const applianceRef = brigadeRef.collection('appliances').doc(applianceId)
    await applianceRef.set({ callsign, active: true, currentCheckSheetVersion: 1 })
    await applianceRef.collection('checkSheetVersions').doc('1').set({
      version: 1,
      createdAt: FieldValue.serverTimestamp(),
      origin: { type: 'editor' },
      sections,
    })
  }

  await deleteAllDocs(brigadeRef.collection('checks'))

  const previousDate = addDays(currentCheckDate(today(), checkDay), -7)
  const monthly = isLastOfMonth(previousDate)

  await brigadeRef
    .collection('checks')
    .doc(`e2e1_${previousDate}`)
    .set({
      applianceId: 'e2e1',
      scheduledDate: previousDate,
      monthly,
      checkSheetVersion: 1,
      responses: {
        [torchId]: 'Y',
        [radioId]: 'Y',
        [helmetId]: 'N',
        [fuelId]: 'FULL',
        [regoId]: '31/12/26',
        [odometerId]: '12345',
        [ladderId]: 'Y',
      },
      updatedAt: FieldValue.serverTimestamp(),
    })

  await brigadeRef
    .collection('checks')
    .doc(`e2e2_${previousDate}`)
    .set({
      applianceId: 'e2e2',
      scheduledDate: previousDate,
      monthly,
      checkSheetVersion: 1,
      responses: { [torchId]: 'Y' },
      updatedAt: FieldValue.serverTimestamp(),
    })

  console.log(`Seeded brigade "${SLUG}" (checkDay ${String(checkDay)}) with appliances e2e1, e2e2.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

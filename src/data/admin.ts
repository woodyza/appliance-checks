import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { firstOfNextMonth } from '../domain/schedule'
import type { Brigade, Check } from '../domain/types'
import { db } from '../firebase'

export interface BrigadeSummary {
  slug: string
  brigade: Brigade
}

export async function listBrigades(): Promise<BrigadeSummary[]> {
  const snapshot = await getDocs(collection(db, 'brigades'))
  return snapshot.docs
    .map((snap) => ({ slug: snap.id, brigade: snap.data() as Brigade }))
    .sort((a, b) => a.brigade.name.localeCompare(b.brigade.name))
}

export async function listChecksInMonth(slug: string, applianceId: string, month: string): Promise<Check[]> {
  const start = `${month}-01`
  const end = firstOfNextMonth(start)
  const snapshot = await getDocs(
    query(
      collection(db, 'brigades', slug, 'checks'),
      where('applianceId', '==', applianceId),
      where('scheduledDate', '>=', start),
      where('scheduledDate', '<', end),
      orderBy('scheduledDate'),
    ),
  )
  return snapshot.docs.map((snap) => snap.data() as Check)
}

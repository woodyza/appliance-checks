import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { firstOfNextMonth } from '../domain/schedule'
import type { AdminRole, AdminUser, Brigade, Check } from '../domain/types'
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

export async function listAdminUsers(): Promise<AdminUser[]> {
  const snapshot = await getDocs(collection(db, 'adminUsers'))
  return snapshot.docs
    .map((snap) => {
      const data = snap.data()
      return {
        email: data.email as string,
        displayName: data.displayName as string | null,
        role: data.role as AdminRole,
        brigadeIds: data.brigadeIds as string[],
      }
    })
    .sort((a, b) => a.email.localeCompare(b.email))
}

export interface AdminUserFields {
  email: string
  displayName: string | null
  role: AdminRole
  brigadeIds: string[]
}

export async function createAdminUser(user: AdminUserFields): Promise<void> {
  await setDoc(doc(db, 'adminUsers', user.email), { ...user, createdAt: serverTimestamp() })
}

export async function updateAdminUser(
  email: string,
  fields: Pick<AdminUserFields, 'displayName' | 'role' | 'brigadeIds'>,
): Promise<void> {
  await updateDoc(doc(db, 'adminUsers', email), fields)
}

export async function deleteAdminUser(email: string): Promise<void> {
  await deleteDoc(doc(db, 'adminUsers', email))
}

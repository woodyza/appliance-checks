import {
  collection,
  type DocumentData,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { batches } from '../domain/adminProfile'
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

// Firestore caps an `in` filter at 30 values, and an empty one throws.
const IN_QUERY_LIMIT = 30

export async function listBrigadesById(brigadeIds: string[]): Promise<BrigadeSummary[]> {
  const snapshots = await Promise.all(
    batches(brigadeIds, IN_QUERY_LIMIT).map((ids) =>
      getDocs(query(collection(db, 'brigades'), where('brigadeId', 'in', ids))),
    ),
  )
  return snapshots
    .flatMap((snapshot) => snapshot.docs)
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

function toAdminUser(data: DocumentData): AdminUser {
  return {
    email: data.email as string,
    displayName: data.displayName as string | null,
    role: data.role as AdminRole,
    brigadeIds: data.brigadeIds as string[],
  }
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const snapshot = await getDocs(collection(db, 'adminUsers'))
  return snapshot.docs.map((snap) => toAdminUser(snap.data())).sort((a, b) => a.email.localeCompare(b.email))
}

/** The signed-in person's own `adminUsers` doc (the only one a non-superadmin may read), or null if there isn't one. */
export async function getOwnAdminUser(email: string): Promise<AdminUser | null> {
  const snap = await getDoc(doc(db, 'adminUsers', email))
  return snap.exists() ? toAdminUser(snap.data()) : null
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

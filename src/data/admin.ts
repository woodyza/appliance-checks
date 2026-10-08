import {
  collection,
  type DocumentData,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { batches } from '../domain/adminProfile'
import type { NormalisedBrigade } from '../domain/brigade'
import { firstOfNextMonth } from '../domain/schedule'
import { generateSlug } from '../domain/slug'
import type { AdminRole, AdminUser, Brigade, BrigadeSettings, Check, MonthlyReportSettings } from '../domain/types'
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

/** An `adminUsers` doc, or null if there isn't one. A non-superadmin may only read their own. */
export async function getAdminUser(email: string): Promise<AdminUser | null> {
  const snap = await getDoc(doc(db, 'adminUsers', email))
  return snap.exists() ? toAdminUser(snap.data()) : null
}

export interface AdminUserFields {
  email: string
  displayName: string | null
  role: AdminRole
  brigadeIds: string[]
}

export class AdminUserExists extends Error {}

export async function createAdminUser(user: AdminUserFields): Promise<void> {
  const ref = doc(db, 'adminUsers', user.email)
  await runTransaction(db, async (tx) => {
    if ((await tx.get(ref)).exists()) throw new AdminUserExists()
    tx.set(ref, { ...user, createdAt: serverTimestamp() })
  })
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

function settingsRef(slug: string) {
  return doc(db, 'brigades', slug, 'private', 'settings')
}

export async function getBrigadeSettings(slug: string): Promise<BrigadeSettings> {
  const snap = await getDoc(settingsRef(slug))
  return snap.exists() ? (snap.data() as BrigadeSettings) : {}
}

function monthlyReportRef(slug: string) {
  return doc(db, 'brigades', slug, 'private', 'monthlyReport')
}

export async function getMonthlyReportSettings(slug: string): Promise<MonthlyReportSettings> {
  const snap = await getDoc(monthlyReportRef(slug))
  return snap.exists() ? (snap.data() as MonthlyReportSettings) : {}
}

class SlugTaken extends Error {}

const SLUG_ATTEMPTS = 5

/** Creates an active brigade under a fresh Brigade Link slug, and returns the slug. */
export async function createBrigade(fields: NormalisedBrigade): Promise<string> {
  const brigade: Brigade = { brigadeId: crypto.randomUUID(), name: fields.name, checkDay: fields.checkDay, active: true }
  const settings: BrigadeSettings = { weeklyEmail: fields.weeklyEmail }
  if (fields.reportEmail !== null) settings.reportEmail = fields.reportEmail

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug = generateSlug()
    const ref = doc(db, 'brigades', slug)
    try {
      await runTransaction(db, async (tx) => {
        if ((await tx.get(ref)).exists()) throw new SlugTaken()
        tx.set(ref, brigade)
        tx.set(settingsRef(slug), settings)
      })
      return slug
    } catch (err) {
      if (!(err instanceof SlugTaken)) throw err
    }
  }
  throw new Error(`Could not generate a unique brigade slug after ${String(SLUG_ATTEMPTS)} attempts.`)
}

export interface BrigadeUpdateScope {
  /** The rules let only the superadmin change `active`. */
  active: boolean
  /** The rules keep the settings from a Brigade Admin. */
  settings: boolean
  /** Any admin of the brigade can change its Monthly Report email. */
  monthlyReport: boolean
}

export async function updateBrigade(slug: string, fields: NormalisedBrigade, scope: BrigadeUpdateScope): Promise<void> {
  const batch = writeBatch(db)
  batch.update(doc(db, 'brigades', slug), {
    name: fields.name,
    checkDay: fields.checkDay,
    ...(scope.active ? { active: fields.active } : {}),
  })
  if (scope.settings) {
    batch.set(
      settingsRef(slug),
      { reportEmail: fields.reportEmail ?? deleteField(), weeklyEmail: fields.weeklyEmail },
      { merge: true },
    )
  }
  if (scope.monthlyReport) {
    batch.set(monthlyReportRef(slug), {
      enabled: fields.monthlyReportEnabled,
      email: fields.monthlyReportEmail ?? '',
    })
  }
  await batch.commit()
}

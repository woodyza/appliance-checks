import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  type Timestamp,
  where,
  setDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Appliance, Brigade, Check, CheckSheetOrigin, CheckSheetVersion, Section } from '../domain/types'

export function checkId(applianceId: string, scheduledDate: string): string {
  return `${applianceId}_${scheduledDate}`
}

export async function getBrigade(slug: string): Promise<Brigade | null> {
  const snapshot = await getDoc(doc(db, 'brigades', slug))
  return snapshot.exists() ? (snapshot.data() as Brigade) : null
}

export async function getAppliance(slug: string, applianceId: string): Promise<Appliance | null> {
  const snapshot = await getDoc(doc(db, 'brigades', slug, 'appliances', applianceId))
  return snapshot.exists() ? (snapshot.data() as Appliance) : null
}

export interface ApplianceSummary extends Appliance {
  id: string
}

export async function listAppliances(slug: string): Promise<ApplianceSummary[]> {
  const snapshot = await getDocs(query(collection(db, 'brigades', slug, 'appliances'), where('active', '==', true)))
  return snapshot.docs
    .map((snap) => ({ id: snap.id, ...(snap.data() as Appliance) }))
    .sort((a, b) => a.callsign.localeCompare(b.callsign))
}

const versionCache = new Map<string, CheckSheetVersion>()

function versionCacheKey(slug: string, applianceId: string, version: number): string {
  return `${slug}/${applianceId}/${String(version)}`
}

/** Synchronous cache check: versions are immutable, so a cache hit needs no await at all. */
export function getCachedVersion(slug: string, applianceId: string, version: number): CheckSheetVersion | undefined {
  return versionCache.get(versionCacheKey(slug, applianceId, version))
}

export async function getVersion(slug: string, applianceId: string, version: number): Promise<CheckSheetVersion> {
  const cacheKey = versionCacheKey(slug, applianceId, version)
  const cached = versionCache.get(cacheKey)
  if (cached) return cached

  const ref = doc(db, 'brigades', slug, 'appliances', applianceId, 'checkSheetVersions', String(version))
  const snapshot = await getDoc(ref)
  if (!snapshot.exists()) {
    throw new Error(`Check Sheet version ${String(version)} not found for appliance ${applianceId}.`)
  }
  const data = snapshot.data()
  const result: CheckSheetVersion = {
    version: data.version as number,
    createdAt: (data.createdAt as Timestamp).toDate(),
    origin: data.origin as CheckSheetOrigin,
    sections: data.sections as Section[],
  }
  versionCache.set(cacheKey, result)
  return result
}

export async function listRecentChecks(slug: string, applianceId: string, since: string): Promise<Check[]> {
  const snapshot = await getDocs(
    query(
      collection(db, 'brigades', slug, 'checks'),
      where('applianceId', '==', applianceId),
      where('scheduledDate', '>=', since),
      orderBy('scheduledDate'),
    ),
  )
  return snapshot.docs.map((snap) => snap.data() as Check)
}

export async function getCheck(slug: string, id: string): Promise<Check | null> {
  const snapshot = await getDoc(doc(db, 'brigades', slug, 'checks', id))
  return snapshot.exists() ? (snapshot.data() as Check) : null
}

export interface CheckFields {
  applianceId: string
  scheduledDate: string
  monthly: boolean
  checkSheetVersion: number
}

export async function writeResponse(
  slug: string,
  fields: CheckFields,
  itemId: string,
  value: string | null,
): Promise<void> {
  const ref = doc(db, 'brigades', slug, 'checks', checkId(fields.applianceId, fields.scheduledDate))
  await setDoc(
    ref,
    {
      ...fields,
      updatedAt: serverTimestamp(),
      responses: { [itemId]: value === null ? deleteField() : value },
    },
    { merge: true },
  )
}

export async function optInToLatest(slug: string, fields: CheckFields): Promise<void> {
  const ref = doc(db, 'brigades', slug, 'checks', checkId(fields.applianceId, fields.scheduledDate))
  await setDoc(ref, { ...fields, updatedAt: serverTimestamp() }, { merge: true })
}

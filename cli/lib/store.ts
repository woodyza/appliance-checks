import { FieldValue, type Firestore, Timestamp, type Transaction } from 'firebase-admin/firestore'
import { generateSlug } from '../../src/domain/slug'
import type { BrigadeSettings, CheckSheetOrigin, CheckSheetVersion, Section } from '../../src/domain/types'
import { SUPERADMIN_COLLECTION, SUPERADMIN_DOC } from './superadmin'

const ALREADY_EXISTS = 6

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === ALREADY_EXISTS
}

export interface CreateBrigadeInput {
  name: string
  checkDay: number
}

export interface CreateBrigadeResult {
  slug: string
  brigadeId: string
}

export async function createBrigade(
  db: Firestore,
  input: CreateBrigadeInput,
  makeSlug: () => string = generateSlug,
): Promise<CreateBrigadeResult> {
  const brigadeId = crypto.randomUUID()

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = makeSlug()
    const brigadeRef = db.collection('brigades').doc(slug)
    const settingsRef = brigadeRef.collection('private').doc('settings')
    try {
      const batch = db.batch()
      batch.create(brigadeRef, { brigadeId, name: input.name, checkDay: input.checkDay, active: true })
      batch.set(settingsRef, {})
      await batch.commit()
      return { slug, brigadeId }
    } catch (error) {
      if (isAlreadyExists(error)) continue
      throw error
    }
  }

  throw new Error('Could not generate a unique brigade slug after 5 attempts.')
}

export interface AddApplianceInput {
  id: string
  callsign: string
}

export async function addAppliance(db: Firestore, slug: string, input: AddApplianceInput): Promise<void> {
  const brigadeRef = db.collection('brigades').doc(slug)
  const brigadeSnapshot = await brigadeRef.get()
  if (!brigadeSnapshot.exists) {
    throw new Error(`No brigade found for slug "${slug}".`)
  }

  const applianceRef = brigadeRef.collection('appliances').doc(input.id)
  try {
    await applianceRef.create({ callsign: input.callsign, active: true, currentCheckSheetVersion: null })
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error(`Appliance id "${input.id}" is already taken in brigade "${slug}".`, { cause: error })
    }
    throw error
  }
}

export interface BrigadeSettingsUpdate {
  reportEmail?: string | null
  weeklyEmail?: boolean
}

export async function updateBrigadeSettings(
  db: Firestore,
  slug: string,
  update: BrigadeSettingsUpdate,
): Promise<{ before: BrigadeSettings; after: BrigadeSettings }> {
  const brigadeRef = db.collection('brigades').doc(slug)
  const settingsRef = brigadeRef.collection('private').doc('settings')

  return db.runTransaction(async (transaction: Transaction) => {
    const [brigadeSnapshot, settingsSnapshot] = await Promise.all([
      transaction.get(brigadeRef),
      transaction.get(settingsRef),
    ])
    if (!brigadeSnapshot.exists) {
      throw new Error(`No brigade found for slug "${slug}".`)
    }

    const before = (settingsSnapshot.data() ?? {}) as BrigadeSettings
    const after: BrigadeSettings = { ...before }
    const fields: Record<string, unknown> = {}
    if (update.reportEmail === null) {
      delete after.reportEmail
      fields.reportEmail = FieldValue.delete()
    } else if (update.reportEmail !== undefined) {
      after.reportEmail = update.reportEmail
      fields.reportEmail = update.reportEmail
    }
    if (update.weeklyEmail !== undefined) {
      after.weeklyEmail = update.weeklyEmail
      fields.weeklyEmail = update.weeklyEmail
    }

    transaction.set(settingsRef, fields, { merge: true })
    return { before, after }
  })
}

export interface Superadmin {
  uid: string
  email: string
}

export async function setSuperadmin(
  db: Firestore,
  superadmin: Superadmin,
): Promise<{ before: Superadmin | null; after: Superadmin }> {
  const ref = db.collection(SUPERADMIN_COLLECTION).doc(SUPERADMIN_DOC)

  return db.runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(ref)
    const data = snapshot.data() as Superadmin | undefined
    const before = data ? { uid: data.uid, email: data.email } : null
    transaction.set(ref, { ...superadmin, updatedAt: FieldValue.serverTimestamp() })
    return { before, after: superadmin }
  })
}

export async function getCurrentVersion(
  db: Firestore,
  slug: string,
  applianceId: string,
): Promise<CheckSheetVersion | null> {
  const applianceRef = db.collection('brigades').doc(slug).collection('appliances').doc(applianceId)
  const applianceSnapshot = await applianceRef.get()
  if (!applianceSnapshot.exists) {
    throw new Error(`No appliance "${applianceId}" found in brigade "${slug}".`)
  }

  const currentCheckSheetVersion = applianceSnapshot.data()?.currentCheckSheetVersion as number | null | undefined
  if (currentCheckSheetVersion === null || currentCheckSheetVersion === undefined) {
    return null
  }

  const versionSnapshot = await applianceRef
    .collection('checkSheetVersions')
    .doc(String(currentCheckSheetVersion))
    .get()
  const data = versionSnapshot.data()
  if (!data) {
    throw new Error(
      `Appliance "${applianceId}" points to Check Sheet version ${String(currentCheckSheetVersion)}, ` +
        'but that version does not exist.',
    )
  }

  const createdAt = data.createdAt as Timestamp
  return {
    version: data.version as number,
    createdAt: createdAt.toDate(),
    origin: data.origin as CheckSheetOrigin,
    sections: data.sections as Section[],
  }
}

export interface WriteVersionInput {
  expectedCurrent: number | null
  sections: Section[]
  origin: CheckSheetOrigin
}

export async function writeVersion(
  db: Firestore,
  slug: string,
  applianceId: string,
  input: WriteVersionInput,
): Promise<number> {
  const applianceRef = db.collection('brigades').doc(slug).collection('appliances').doc(applianceId)

  return db.runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(applianceRef)
    const current = (snapshot.data()?.currentCheckSheetVersion ?? null) as number | null
    if (current !== input.expectedCurrent) {
      throw new Error(
        `Appliance "${applianceId}" current Check Sheet version changed ` +
          `(expected ${String(input.expectedCurrent)}, was ${String(current)}).`,
      )
    }

    const nextVersion = (input.expectedCurrent ?? 0) + 1
    const versionRef = applianceRef.collection('checkSheetVersions').doc(String(nextVersion))
    transaction.create(versionRef, {
      version: nextVersion,
      createdAt: FieldValue.serverTimestamp(),
      origin: input.origin,
      sections: input.sections,
    })
    transaction.update(applianceRef, { currentCheckSheetVersion: nextVersion })
    return nextVersion
  })
}

export async function hasCheckSheetDraft(db: Firestore, slug: string, applianceId: string): Promise<boolean> {
  const snapshot = await db
    .collection('brigades')
    .doc(slug)
    .collection('appliances')
    .doc(applianceId)
    .collection('private')
    .doc('checkSheetDraft')
    .get()
  return snapshot.exists
}

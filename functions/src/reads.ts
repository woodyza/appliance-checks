import type { Firestore, Timestamp } from 'firebase-admin/firestore'
import { firstOfNextMonth } from '../../src/domain/schedule'
import type {
  AdminRole,
  AdminUser,
  Appliance,
  Check,
  CheckSheetOrigin,
  CheckSheetVersion,
  Section,
} from '../../src/domain/types'
import type { ApplianceInput } from '../../src/domain/weeklyEmail'

export async function readVersion(
  db: Firestore,
  slug: string,
  applianceId: string,
  version: number,
): Promise<CheckSheetVersion> {
  const snapshot = await db
    .collection('brigades')
    .doc(slug)
    .collection('appliances')
    .doc(applianceId)
    .collection('checkSheetVersions')
    .doc(String(version))
    .get()
  const data = snapshot.data()
  if (!data) throw new Error(`Check Sheet version ${String(version)} not found for appliance ${applianceId}`)
  return {
    version: data.version as number,
    createdAt: (data.createdAt as Timestamp).toDate(),
    origin: data.origin as CheckSheetOrigin,
    sections: data.sections as Section[],
  }
}

export type IdentifiedApplianceInput = ApplianceInput & { id: string }

export async function readApplianceInputs(
  db: Firestore,
  slug: string,
  checkDate: string,
): Promise<IdentifiedApplianceInput[]> {
  const brigadeRef = db.collection('brigades').doc(slug)
  const appliances = await brigadeRef.collection('appliances').get()
  const eligible = appliances.docs.filter((doc) => {
    const appliance = doc.data() as Appliance
    return appliance.active && appliance.currentCheckSheetVersion !== null
  })

  return Promise.all(
    eligible.map(async (doc): Promise<IdentifiedApplianceInput> => {
      const appliance = doc.data() as Appliance
      const checkSnapshot = await brigadeRef.collection('checks').doc(`${doc.id}_${checkDate}`).get()
      const check = checkSnapshot.exists ? (checkSnapshot.data() as Check) : null
      const current = await readVersion(db, slug, doc.id, appliance.currentCheckSheetVersion!)
      const stamped =
        check === null
          ? null
          : check.checkSheetVersion === current.version
            ? current
            : await readVersion(db, slug, doc.id, check.checkSheetVersion)
      return { id: doc.id, appliance, check, stamped, current }
    }),
  )
}

export async function readChecksInMonth(
  db: Firestore,
  slug: string,
  applianceId: string,
  month: string,
): Promise<Check[]> {
  const start = `${month}-01`
  const snapshot = await db
    .collection('brigades')
    .doc(slug)
    .collection('checks')
    .where('applianceId', '==', applianceId)
    .where('scheduledDate', '>=', start)
    .where('scheduledDate', '<', firstOfNextMonth(start))
    .orderBy('scheduledDate')
    .get()
  return snapshot.docs.map((doc) => doc.data() as Check)
}

export async function readAdminUsers(db: Firestore): Promise<AdminUser[]> {
  const snapshot = await db.collection('adminUsers').get()
  return snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      email: data.email as string,
      displayName: data.displayName as string | null,
      role: data.role as AdminRole,
      brigadeIds: data.brigadeIds as string[],
    }
  })
}

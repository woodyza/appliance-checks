import type { Firestore, Timestamp } from 'firebase-admin/firestore'
import { addDays, weekday } from '../../src/domain/schedule'
import type {
  AdminRole,
  AdminUser,
  Appliance,
  Brigade,
  BrigadeSettings,
  Check,
  CheckSheetOrigin,
  CheckSheetVersion,
  Section,
} from '../../src/domain/types'
import {
  groupByRecipient,
  renderWeeklyEmail,
  resolveRecipients,
  summariseBrigade,
  wantsWeeklyEmail,
} from '../../src/domain/weeklyEmail'
import type { ApplianceInput, BrigadeSummary } from '../../src/domain/weeklyEmail'

export interface WeeklyEmailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export interface WeeklyEmailRun {
  sent: { to: string; brigades: string[] }[]
  skipped: { brigade: string; reason: string }[]
  failed: { target: string; brigades?: string[]; error: string }[]
}

export interface SendWeeklyEmailsArgs {
  db: Firestore
  send: (message: WeeklyEmailMessage) => Promise<void>
  today: string
  adminUrl: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readVersion(
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

async function readApplianceInputs(
  db: Firestore,
  slug: string,
  checkDate: string,
): Promise<ApplianceInput[]> {
  const brigadeRef = db.collection('brigades').doc(slug)
  const appliances = await brigadeRef.collection('appliances').get()
  const eligible = appliances.docs.filter((doc) => {
    const appliance = doc.data() as Appliance
    return appliance.active && appliance.currentCheckSheetVersion !== null
  })

  return Promise.all(
    eligible.map(async (doc): Promise<ApplianceInput> => {
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
      return { appliance, check, stamped, current }
    }),
  )
}

async function readAdminUsers(db: Firestore): Promise<AdminUser[]> {
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

export async function sendWeeklyEmails({ db, send, today, adminUrl }: SendWeeklyEmailsArgs): Promise<WeeklyEmailRun> {
  const run: WeeklyEmailRun = { sent: [], skipped: [], failed: [] }
  const checkDate = addDays(today, -7)

  let admins: Promise<AdminUser[]> | null = null
  const adminUsers = (): Promise<AdminUser[]> => (admins ??= readAdminUsers(db))

  const brigades = await db.collection('brigades').where('active', '==', true).get()
  const entries: { summary: BrigadeSummary; recipients: string[] }[] = []

  for (const doc of brigades.docs) {
    const brigade = doc.data() as Brigade
    if (brigade.checkDay !== weekday(today)) continue

    try {
      const settingsSnapshot = await doc.ref.collection('private').doc('settings').get()
      const settings = (settingsSnapshot.data() ?? {}) as BrigadeSettings
      if (!wantsWeeklyEmail(settings)) {
        run.skipped.push({ brigade: brigade.name, reason: 'weekly email is off' })
        continue
      }

      const summary = summariseBrigade(brigade, await readApplianceInputs(db, doc.id, checkDate), today)
      if (summary.appliances.length === 0) {
        run.skipped.push({ brigade: brigade.name, reason: 'no appliances with a Check Sheet' })
        continue
      }

      const needsAdmins = !settings.reportEmail?.trim()
      const recipients = resolveRecipients(brigade, settings, needsAdmins ? await adminUsers() : [])
      if (recipients.length === 0) {
        run.skipped.push({ brigade: brigade.name, reason: 'no recipients' })
        continue
      }
      entries.push({ summary, recipients })
    } catch (error) {
      run.failed.push({ target: brigade.name, error: errorMessage(error) })
    }
  }

  for (const { to, summaries } of groupByRecipient(entries)) {
    const brigadeNames = summaries.map((summary) => summary.brigadeName)
    try {
      await send({ to, ...renderWeeklyEmail(summaries, checkDate, adminUrl) })
      run.sent.push({ to, brigades: brigadeNames })
    } catch (error) {
      run.failed.push({ target: to, brigades: brigadeNames, error: errorMessage(error) })
    }
  }

  return run
}

import type { Firestore } from 'firebase-admin/firestore'
import { addDays, weekday } from '../../src/domain/schedule'
import type { AdminUser, Brigade, BrigadeSettings } from '../../src/domain/types'
import {
  groupByRecipient,
  renderWeeklyEmail,
  resolveRecipients,
  summariseBrigade,
  wantsWeeklyEmail,
} from '../../src/domain/weeklyEmail'
import type { BrigadeSummary } from '../../src/domain/weeklyEmail'
import { errorMessage } from './email'
import type { EmailMessage } from './email'
import { readAdminUsers, readApplianceInputs } from './reads'

export interface WeeklyEmailRun {
  sent: { to: string; brigades: string[] }[]
  skipped: { brigade: string; reason: string }[]
  failed: { target: string; brigades?: string[]; error: string }[]
}

export interface SendWeeklyEmailsArgs {
  db: Firestore
  send: (message: EmailMessage) => Promise<void>
  today: string
  adminUrl: string
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

import { FieldValue } from 'firebase-admin/firestore'
import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import {
  alreadySent,
  monthlyReportRecipient,
  renderMonthlyReportEmail,
  shouldSend,
} from '../../src/domain/monthlyReportEmail'
import { buildMonthlyReport, monthlyReportFilename } from '../../src/domain/report'
import { lastCheckOfMonth } from '../../src/domain/schedule'
import type { Brigade, CheckSheetVersion, MonthlyReportSettings } from '../../src/domain/types'
import { summariseBrigade } from '../../src/domain/weeklyEmail'
import { buildMonthlyReportPdf } from '../../src/report/pdf'
import { errorMessage } from './email'
import type { EmailMessage } from './email'
import { readApplianceInputs, readChecksInMonth, readVersion } from './reads'
import type { IdentifiedApplianceInput } from './reads'

export interface MonthlyReportRun {
  sent: { to: string; brigade: string }[]
  skipped: { brigade: string; reason: string }[]
  failed: { target: string; error: string }[]
}

export interface SendMonthlyReportEmailsArgs {
  db: Firestore
  send: (message: EmailMessage) => Promise<void>
  today: string
  now: Date
}

async function buildAttachment(
  db: Firestore,
  slug: string,
  brigade: Brigade,
  input: IdentifiedApplianceInput,
  month: string,
  today: string,
  now: Date,
): Promise<NonNullable<EmailMessage['attachments']>[number]> {
  const { id, appliance, current } = input
  const checks = await readChecksInMonth(db, slug, id, month)
  const versions = new Map<number, CheckSheetVersion>()
  for (const versionNumber of new Set(checks.map((check) => check.checkSheetVersion))) {
    versions.set(versionNumber, await readVersion(db, slug, id, versionNumber))
  }

  const report = buildMonthlyReport({ brigade, appliance, month, checks, versions, currentVersion: current!, today })
  const pdf = await buildMonthlyReportPdf(report, now)
  return { filename: monthlyReportFilename(appliance.callsign, month), content: Buffer.from(pdf.output('arraybuffer')) }
}

async function readSentMonth(sentRef: DocumentReference): Promise<string | undefined> {
  const snapshot = await sentRef.get()
  return (snapshot.data() as { month?: string } | undefined)?.month
}

export async function sendMonthlyReportEmails({
  db,
  send,
  today,
  now,
}: SendMonthlyReportEmailsArgs): Promise<MonthlyReportRun> {
  const run: MonthlyReportRun = { sent: [], skipped: [], failed: [] }

  const brigades = await db.collection('brigades').where('active', '==', true).get()
  for (const doc of brigades.docs) {
    const brigade = doc.data() as Brigade

    try {
      const settingsSnapshot = await doc.ref.collection('private').doc('monthlyReport').get()
      const settings = (settingsSnapshot.data() ?? {}) as MonthlyReportSettings
      if (settings.enabled !== true) continue

      const to = monthlyReportRecipient(settings)
      if (to === null) {
        run.skipped.push({ brigade: brigade.name, reason: 'no valid Monthly Report email address' })
        continue
      }

      const checkDate = lastCheckOfMonth(today, brigade.checkDay)
      const month = checkDate.slice(0, 7)
      const sentRef = doc.ref.collection('private').doc('monthlyReportSent')
      if (alreadySent(month, await readSentMonth(sentRef))) continue

      const inputs = await readApplianceInputs(db, doc.id, checkDate)
      const summary = summariseBrigade(brigade, inputs, today)
      if (summary.appliances.length === 0) {
        run.skipped.push({ brigade: brigade.name, reason: 'no appliances with a Check Sheet' })
        continue
      }
      if (!shouldSend(summary, checkDate, today)) continue

      const attachments = await Promise.all(
        [...inputs]
          .sort((a, b) => a.appliance.callsign.localeCompare(b.appliance.callsign))
          .map((input) => buildAttachment(db, doc.id, brigade, input, month, today, now)),
      )
      await send({ to, ...renderMonthlyReportEmail(summary, checkDate), attachments })
      run.sent.push({ to, brigade: brigade.name })
      await sentRef.set({ month, sentAt: FieldValue.serverTimestamp() })
    } catch (error) {
      run.failed.push({ target: brigade.name, error: errorMessage(error) })
    }
  }

  return run
}

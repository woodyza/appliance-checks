import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { defineSecret, defineString, projectID } from 'firebase-functions/params'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { createTransport } from 'nodemailer'
import { CHECK_TIME_ZONE, today } from '../../src/domain/schedule'
import type { EmailMessage } from './email'
import { sendMonthlyReportEmails } from './sendMonthlyReportEmails'
import { sendWeeklyEmails } from './sendWeeklyEmails'

initializeApp()

const gmailAppPassword = defineSecret('GMAIL_APP_PASSWORD')
const mailFrom = defineString('MAIL_FROM')

export const dailyEmails = onSchedule(
  {
    schedule: '0 7 * * *',
    timeZone: CHECK_TIME_ZONE,
    region: 'australia-southeast1',
    secrets: [gmailAppPassword],
    retryCount: 0,
    timeoutSeconds: 300,
  },
  async () => {
    const transport = createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: mailFrom.value(), pass: gmailAppPassword.value() },
    })
    const send = async (message: EmailMessage): Promise<void> => {
      await transport.sendMail({ from: mailFrom.value(), ...message })
    }

    const db = getFirestore()
    const date = today()
    const weekly = await sendWeeklyEmails({
      db,
      send,
      today: date,
      adminUrl: `https://${projectID.value()}.web.app/admin`,
    })
    for (const sent of weekly.sent) logger.info('Sent weekly email', sent)
    for (const skipped of weekly.skipped) logger.warn('Skipped brigade', skipped)
    for (const failed of weekly.failed) logger.error('Weekly email failed', failed)

    const monthly = await sendMonthlyReportEmails({ db, send, today: date, now: new Date() })
    for (const sent of monthly.sent) logger.info('Sent Monthly Report email', sent)
    for (const skipped of monthly.skipped) logger.warn('Skipped Monthly Report brigade', skipped)
    for (const failed of monthly.failed) logger.error('Monthly Report email failed', failed)

    // With retries off this only marks the run as failed. A failed weekly email waits for the
    // next Check Day; a failed Monthly Report email is retried by tomorrow's run.
    const failures = weekly.failed.length + monthly.failed.length
    if (failures > 0) throw new Error(`${failures} email failure(s)`)
  },
)

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { defineSecret, defineString, projectID } from 'firebase-functions/params'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { createTransport } from 'nodemailer'
import { CHECK_TIME_ZONE, today } from '../../src/domain/schedule'
import { sendWeeklyEmails } from './sendWeeklyEmails'
import type { WeeklyEmailMessage } from './sendWeeklyEmails'

initializeApp()

const gmailAppPassword = defineSecret('GMAIL_APP_PASSWORD')
const mailFrom = defineString('MAIL_FROM')

export const weeklyVsoEmail = onSchedule(
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
    const send = async (message: WeeklyEmailMessage): Promise<void> => {
      await transport.sendMail({ from: mailFrom.value(), ...message })
    }

    const run = await sendWeeklyEmails({
      db: getFirestore(),
      send,
      today: today(),
      adminUrl: `https://${projectID.value()}.web.app/admin`,
    })

    for (const sent of run.sent) logger.info('Sent weekly email', sent)
    for (const skipped of run.skipped) logger.warn('Skipped brigade', skipped)
    for (const failed of run.failed) logger.error('Weekly email failed', failed)
    // With retries off this only marks the run as failed; nothing is resent.
    if (run.failed.length > 0) throw new Error(`${run.failed.length} weekly email failure(s)`)
  },
)

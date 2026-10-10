import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { defineSecret, projectID } from 'firebase-functions/params'
import { onMessagePublished } from 'firebase-functions/v2/pubsub'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { GoogleAuth } from 'google-auth-library'
import { createTransport } from 'nodemailer'
import { CHECK_TIME_ZONE, today } from '../../src/domain/schedule'
import type { EmailMessage } from './email'
import { applyBudgetNotification, KILL_SWITCH_SERVICE_ACCOUNT_ID, KILL_SWITCH_TOPIC } from './killSwitch'
import { sendMonthlyReportEmails } from './sendMonthlyReportEmails'
import { sendWeeklyEmails } from './sendWeeklyEmails'

initializeApp()

const gmailAppPassword = defineSecret('GMAIL_APP_PASSWORD')
const mailFrom = defineSecret('MAIL_FROM')

export const dailyEmails = onSchedule(
  {
    schedule: '0 7 * * *',
    timeZone: CHECK_TIME_ZONE,
    region: 'australia-southeast1',
    secrets: [gmailAppPassword, mailFrom],
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

// Unlinks billing once the budget `make provision` sets up is exceeded, which drops the project
// back to Spark. It runs as its own service account, so only this function can unlink billing.
// No retries: if unlinking fails, the budget's next notification (within hours) tries again.
export const billingKillSwitch = onMessagePublished(
  {
    topic: KILL_SWITCH_TOPIC,
    region: 'australia-southeast1',
    serviceAccount: `${KILL_SWITCH_SERVICE_ACCOUNT_ID}@`,
    retry: false,
  },
  async (event) => {
    const unlink = async (): Promise<void> => {
      const client = await new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' }).getClient()
      await client.request({
        url: `https://cloudbilling.googleapis.com/v1/projects/${projectID.value()}/billingInfo`,
        method: 'PUT',
        data: { billingAccountName: '' },
      })
    }

    const outcome = await applyBudgetNotification(event.data.message.json, unlink)
    if (outcome.action === 'under-budget') logger.info('Under budget', outcome)
    else if (outcome.action === 'unlinked') logger.error('Over budget: unlinked billing', outcome)
    else logger.error('Unreadable budget notification', outcome)
  },
)

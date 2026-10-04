import type { Firestore } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it } from 'vitest'
import { addAppliance, createBrigade, writeVersion } from '../../cli/lib/store'
import { resolveTarget } from '../../cli/lib/target'
import { sendWeeklyEmails } from '../../functions/src/sendWeeklyEmails'
import type { WeeklyEmailMessage } from '../../functions/src/sendWeeklyEmails'
import type { BrigadeSettings, Section } from '../../src/domain/types'

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const PROJECT_ID = 'demo-appliance-checks'
const ADMIN_URL = 'https://appliance-checks-dev.web.app/admin'
const TODAY = '2026-09-28'
const PREVIOUS_CHECK = '2026-09-21'
const MONDAY = 1
const TUESDAY = 2

const SHEET: Section[] = [
  {
    id: 'section-a',
    title: 'Section A',
    items: [{ id: 'aaa22222', label: 'Torch', qty: '1', inputType: 'yn', scope: 'weekly' }],
  },
]

async function clearFirestore(): Promise<void> {
  await fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: 'DELETE',
  })
}

interface SeedOptions {
  checkDay?: number
  active?: boolean
  settings?: BrigadeSettings
}

async function seedBrigade(name: string, { checkDay = MONDAY, active = true, settings = {} }: SeedOptions = {}) {
  const { slug } = await createBrigade(db, { name, checkDay })
  const brigadeRef = db.collection('brigades').doc(slug)
  if (!active) await brigadeRef.update({ active })
  await brigadeRef.collection('private').doc('settings').set(settings)
  await addAppliance(db, slug, { id: '8011', callsign: `${name} 1` })
  await writeVersion(db, slug, '8011', { expectedCurrent: null, sections: SHEET, origin: { type: 'editor' } })
  await brigadeRef
    .collection('checks')
    .doc(`8011_${PREVIOUS_CHECK}`)
    .set({
      applianceId: '8011',
      scheduledDate: PREVIOUS_CHECK,
      monthly: false,
      checkSheetVersion: 1,
      responses: { aaa22222: 'Y' },
    })
  return slug
}

let db: Firestore
let messages: WeeklyEmailMessage[]

async function recordMessage(message: WeeklyEmailMessage): Promise<void> {
  messages.push(message)
}

beforeEach(async () => {
  db = await resolveTarget('emulator')
  await clearFirestore()
  messages = []
})

describe('sendWeeklyEmails', () => {
  it("emails only brigades whose Check Day is today's weekday", async () => {
    await seedBrigade('Monday', { checkDay: MONDAY, settings: { reportEmail: 'monday@x.nz' } })
    await seedBrigade('Tuesday', { checkDay: TUESDAY, settings: { reportEmail: 'tuesday@x.nz' } })

    const run = await sendWeeklyEmails({ db, send: recordMessage, today: TODAY, adminUrl: ADMIN_URL })

    expect(messages.map((message) => message.to)).toEqual(['monday@x.nz'])
    expect(messages[0].subject).toBe('Appliance checks, Mon 21 Sep: all complete')
    expect(run.sent).toEqual([{ to: 'monday@x.nz', brigades: ['Monday'] }])
  })

  it('emails nothing for an inactive brigade', async () => {
    await seedBrigade('Retired', { active: false, settings: { reportEmail: 'retired@x.nz' } })

    const run = await sendWeeklyEmails({ db, send: recordMessage, today: TODAY, adminUrl: ADMIN_URL })

    expect(messages).toEqual([])
    expect(run.sent).toEqual([])
  })

  it('still sends the other emails, and reports the failure, when one send throws', async () => {
    await seedBrigade('Alpha', { settings: { reportEmail: 'alpha@x.nz' } })
    await seedBrigade('Bravo', { settings: { reportEmail: 'bravo@x.nz' } })
    const send = async (message: WeeklyEmailMessage): Promise<void> => {
      if (message.to === 'alpha@x.nz') throw new Error('mailbox full')
      await recordMessage(message)
    }

    const run = await sendWeeklyEmails({ db, send, today: TODAY, adminUrl: ADMIN_URL })

    expect(messages.map((message) => message.to)).toEqual(['bravo@x.nz'])
    expect(run.sent).toEqual([{ to: 'bravo@x.nz', brigades: ['Bravo'] }])
    expect(run.failed).toEqual([{ target: 'alpha@x.nz', brigades: ['Alpha'], error: 'mailbox full' }])
  })

  it('reports a brigade with the weekly email turned off as skipped and sends nothing', async () => {
    await seedBrigade('Quiet', { settings: { reportEmail: 'quiet@x.nz', weeklyEmail: false } })

    const run = await sendWeeklyEmails({ db, send: recordMessage, today: TODAY, adminUrl: ADMIN_URL })

    expect(messages).toEqual([])
    expect(run.skipped).toEqual([{ brigade: 'Quiet', reason: expect.stringContaining('off') }])
  })
})

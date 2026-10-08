import type { Firestore } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it } from 'vitest'
import { addAppliance, createBrigade, writeVersion } from '../../cli/lib/store'
import { resolveTarget } from '../../cli/lib/target'
import type { EmailMessage } from '../../functions/src/email'
import { sendMonthlyReportEmails } from '../../functions/src/sendMonthlyReportEmails'
import type { MonthlyReportSettings, Section } from '../../src/domain/types'

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const PROJECT_ID = 'demo-appliance-checks'
const TUESDAY = 2
const LAST_CHECK = '2026-09-29'
const NOW = new Date('2026-09-30T19:00:00Z')
const DAY_AFTER = '2026-10-01'
const FIRST_DAY = '2026-09-30'
const WINDOW_CLOSED = '2026-10-06'

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
  settings?: MonthlyReportSettings | null
  applianceStates?: ('complete' | 'incomplete')[]
}

async function seedBrigade(
  name: string,
  { settings = { enabled: true, email: `${name.toLowerCase()}@x.nz` }, applianceStates = ['complete'] }: SeedOptions = {},
) {
  const { slug } = await createBrigade(db, { name, checkDay: TUESDAY })
  const brigadeRef = db.collection('brigades').doc(slug)
  if (settings) await brigadeRef.collection('private').doc('monthlyReport').set(settings)

  for (const [index, state] of applianceStates.entries()) {
    // Ids descend as Callsigns ascend, so Firestore's id order isn't Callsign order.
    const id = String(8019 - index)
    await addAppliance(db, slug, { id, callsign: `${name} ${String(index + 1)}` })
    await writeVersion(db, slug, id, { expectedCurrent: null, sections: SHEET, origin: { type: 'editor' } })
    await brigadeRef
      .collection('checks')
      .doc(`${id}_${LAST_CHECK}`)
      .set({
        applianceId: id,
        scheduledDate: LAST_CHECK,
        monthly: false,
        checkSheetVersion: 1,
        responses: state === 'complete' ? { aaa22222: 'Y' } : {},
      })
  }
  return slug
}

async function marker(slug: string): Promise<{ month: string } | undefined> {
  const snapshot = await db.collection('brigades').doc(slug).collection('private').doc('monthlyReportSent').get()
  return snapshot.data() as { month: string } | undefined
}

let db: Firestore
let messages: EmailMessage[]

async function recordMessage(message: EmailMessage): Promise<void> {
  messages.push(message)
}

function run(today: string, send: (message: EmailMessage) => Promise<void> = recordMessage) {
  return sendMonthlyReportEmails({ db, send, today, now: NOW })
}

beforeEach(async () => {
  db = await resolveTarget('emulator')
  await clearFirestore()
  messages = []
})

describe('sendMonthlyReportEmails', () => {
  it('sends one email with the Appliance PDF once every Appliance is complete, and records the month', async () => {
    const slug = await seedBrigade('Alpha')

    const result = await run(FIRST_DAY)

    expect(messages).toHaveLength(1)
    expect(messages[0].to).toBe('alpha@x.nz')
    expect(messages[0].subject).toBe('Monthly Reports: Alpha, September 2026')
    expect(messages[0].attachments).toHaveLength(1)
    expect(messages[0].attachments![0].filename).toBe('Alpha 1-2026-09.pdf')
    expect(messages[0].attachments![0].content.subarray(0, 4).toString()).toBe('%PDF')
    expect(result.sent).toEqual([{ to: 'alpha@x.nz', brigade: 'Alpha' }])
    expect(await marker(slug)).toMatchObject({ month: '2026-09' })
  })

  it('attaches a PDF per Appliance, sorted by Callsign', async () => {
    await seedBrigade('Alpha', { applianceStates: ['complete', 'complete'] })

    await run(FIRST_DAY)

    expect(messages[0].attachments!.map((attachment) => attachment.filename)).toEqual([
      'Alpha 1-2026-09.pdf',
      'Alpha 2-2026-09.pdf',
    ])
  })

  it('waits while an Appliance is incomplete and the window is open', async () => {
    const slug = await seedBrigade('Alpha', { applianceStates: ['complete', 'incomplete'] })

    await run(FIRST_DAY)

    expect(messages).toEqual([])
    expect(await marker(slug)).toBeUndefined()
  })

  it('sends incomplete Reports once the window has closed', async () => {
    const slug = await seedBrigade('Alpha', { applianceStates: ['complete', 'incomplete'] })

    await run(WINDOW_CLOSED)

    expect(messages).toHaveLength(1)
    expect(messages[0].attachments).toHaveLength(2)
    expect(await marker(slug)).toMatchObject({ month: '2026-09' })
  })

  it('sends nothing once the month has been sent', async () => {
    const slug = await seedBrigade('Alpha')
    await db.collection('brigades').doc(slug).collection('private').doc('monthlyReportSent').set({ month: '2026-09' })

    const result = await run(DAY_AFTER)

    expect(messages).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('records no month and still sends the other brigades when one send throws', async () => {
    const alpha = await seedBrigade('Alpha')
    const bravo = await seedBrigade('Bravo')
    const send = async (message: EmailMessage): Promise<void> => {
      if (message.to === 'alpha@x.nz') throw new Error('mailbox full')
      await recordMessage(message)
    }

    const result = await run(FIRST_DAY, send)

    expect(result.failed).toEqual([{ target: 'Alpha', error: 'mailbox full' }])
    expect(result.sent).toEqual([{ to: 'bravo@x.nz', brigade: 'Bravo' }])
    expect(await marker(alpha)).toBeUndefined()
    expect(await marker(bravo)).toMatchObject({ month: '2026-09' })
  })

  it('ignores a brigade that has turned it off, or never set it up, without logging it', async () => {
    await seedBrigade('Off', { settings: { enabled: false, email: 'off@x.nz' } })
    await seedBrigade('Unset', { settings: null })

    const result = await run(FIRST_DAY)

    expect(messages).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('skips and reports a brigade that is on without an address', async () => {
    await seedBrigade('Blank', { settings: { enabled: true, email: '' } })

    const result = await run(FIRST_DAY)

    expect(messages).toEqual([])
    expect(result.skipped).toEqual([{ brigade: 'Blank', reason: expect.stringContaining('address') }])
  })
})

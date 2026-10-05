import { describe, expect, it } from 'vitest'
import {
  groupByRecipient,
  isFlagged,
  renderWeeklyEmail,
  resolveRecipients,
  statusLabel,
  summariseBrigade,
  wantsWeeklyEmail,
} from '../../src/domain/weeklyEmail'
import type { ApplianceInput, ApplianceStatus, BrigadeSummary } from '../../src/domain/weeklyEmail'
import type {
  AdminUser,
  Appliance,
  Brigade,
  Check,
  CheckSheetVersion,
  Item,
  Section,
} from '../../src/domain/types'

const TORCH = 'aaa22222'
const LADDER = 'bbb22222'
const REGO = 'ccc22222'
const HOSE = 'ddd22222'
const FUEL = 'eee22222'
const OLD = 'fff22222'

const TODAY = '2026-09-28'
const PREVIOUS_CHECK = '2026-09-21'
const ADMIN_URL = 'https://appliance-checks-dev.web.app/admin'

function item(overrides: Partial<Item> = {}): Item {
  return { id: TORCH, label: 'Torch', qty: '1', inputType: 'yn', scope: 'weekly', ...overrides }
}

function sections(): Section[] {
  return [
    {
      id: 'section-a',
      title: 'Section A',
      items: [
        item({ id: TORCH, label: 'Torch', scope: 'weekly' }),
        item({ id: LADDER, label: 'Ladder', scope: 'monthly' }),
        item({ id: REGO, label: 'Rego expiry', inputType: 'written', scope: 'weekly' }),
      ],
    },
    {
      id: 'section-b',
      title: 'Section B',
      items: [item({ id: HOSE, label: 'Hose', scope: 'monthly' }), item({ id: FUEL, label: 'Fuel', scope: 'weekly' })],
    },
  ]
}

function version(overrides: Partial<CheckSheetVersion> = {}): CheckSheetVersion {
  return { version: 1, createdAt: new Date(), origin: { type: 'editor' }, sections: sections(), ...overrides }
}

function brigade(overrides: Partial<Brigade> = {}): Brigade {
  return { brigadeId: 'brigade-1', name: 'Test Brigade', checkDay: 1, active: true, ...overrides }
}

function appliance(overrides: Partial<Appliance> = {}): Appliance {
  return { callsign: 'Test 8011', active: true, currentCheckSheetVersion: 1, ...overrides }
}

function check(overrides: Partial<Check> = {}): Check {
  return {
    applianceId: '8011',
    scheduledDate: PREVIOUS_CHECK,
    monthly: false,
    checkSheetVersion: 1,
    responses: {},
    ...overrides,
  }
}

function input(overrides: Partial<ApplianceInput> = {}): ApplianceInput {
  return { appliance: appliance(), check: null, stamped: null, current: version(), ...overrides }
}

function withCheck(responses: Record<string, string>, checkOverrides: Partial<Check> = {}): ApplianceInput {
  return input({ check: check({ responses, ...checkOverrides }), stamped: version() })
}

const ALL_WEEKLY = { [TORCH]: 'Y', [REGO]: '31/12/26', [FUEL]: 'Y' }

function status(callsign: string, percent: number, started = true): ApplianceStatus {
  return { callsign, percent, started }
}

function summary(brigadeName: string, appliances: ApplianceStatus[]): BrigadeSummary {
  return { brigadeName, appliances }
}

function vso(email: string, brigadeIds: string[], role: AdminUser['role'] = 'vso'): AdminUser {
  return { email, displayName: null, role, brigadeIds }
}

describe('summariseBrigade', () => {
  it('reads a Complete Check as 100 and not flagged', () => {
    const { appliances } = summariseBrigade(brigade(), [withCheck(ALL_WEEKLY)], TODAY)

    expect(appliances[0].percent).toBe(100)
    expect(statusLabel(appliances[0])).toBe('Complete')
    expect(isFlagged(appliances[0])).toBe(false)
  })

  it('rounds a partial Check down and flags it', () => {
    const { appliances } = summariseBrigade(brigade(), [withCheck({ [TORCH]: 'Y', [FUEL]: 'Y' })], TODAY)

    expect(appliances[0].percent).toBe(66)
    expect(statusLabel(appliances[0])).toBe('66%')
    expect(isFlagged(appliances[0])).toBe(true)
  })

  it('reads a missing Check as 0, not started, and flagged', () => {
    const { appliances } = summariseBrigade(brigade(), [input()], TODAY)

    expect(appliances[0].percent).toBe(0)
    expect(statusLabel(appliances[0])).toBe('not started')
    expect(isFlagged(appliances[0])).toBe(true)
  })

  it('counts Monthly Items on a monthly Check', () => {
    const weekly = summariseBrigade(brigade(), [withCheck(ALL_WEEKLY)], TODAY)
    const monthly = summariseBrigade(brigade(), [withCheck(ALL_WEEKLY, { monthly: true })], TODAY)

    expect(weekly.appliances[0].percent).toBe(100)
    expect(monthly.appliances[0].percent).toBe(60)
  })

  it('scores a Check against its stamped version while the current one has moved on', () => {
    const v1 = version({
      version: 1,
      sections: [{ id: 's', title: 'S', items: [item({ id: TORCH }), item({ id: OLD })] }],
    })
    const v2 = version({ version: 2, sections: [{ id: 's', title: 'S', items: [item({ id: TORCH })] }] })
    const stale = input({
      appliance: appliance({ currentCheckSheetVersion: 2 }),
      check: check({ checkSheetVersion: 1, responses: { [OLD]: 'Y' } }),
      stamped: v1,
      current: v2,
    })

    const { appliances } = summariseBrigade(brigade(), [stale], TODAY)

    expect(appliances[0].percent).toBe(50)
  })

  it('leaves out inactive Appliances and ones without a Check Sheet', () => {
    const inputs = [
      input({ appliance: appliance({ callsign: 'Kept' }) }),
      input({ appliance: appliance({ callsign: 'Inactive', active: false }) }),
      input({ appliance: appliance({ callsign: 'No sheet', currentCheckSheetVersion: null }), current: null }),
    ]

    const { appliances } = summariseBrigade(brigade(), inputs, TODAY)

    expect(appliances.map((appliance) => appliance.callsign)).toEqual(['Kept'])
  })
})

describe('resolveRecipients', () => {
  const admins = [
    vso('vso-a@x.nz', ['brigade-1', 'brigade-2']),
    vso('vso-b@x.nz', ['brigade-2']),
    vso('admin@x.nz', ['brigade-1'], 'brigadeAdmin'),
  ]

  it('uses only the Report Email when set, even with VSOs assigned', () => {
    expect(resolveRecipients(brigade(), { reportEmail: 'Team@X.nz' }, admins)).toEqual(['team@x.nz'])
  })

  it("falls back to the brigade's VSOs, not Brigade Admins or other brigades' VSOs", () => {
    expect(resolveRecipients(brigade(), {}, admins)).toEqual(['vso-a@x.nz'])
  })

  it('is empty with neither', () => {
    expect(resolveRecipients(brigade({ brigadeId: 'brigade-3' }), {}, admins)).toEqual([])
  })
})

describe('wantsWeeklyEmail', () => {
  it.each([
    ['missing', {}, true],
    ['false', { weeklyEmail: false }, false],
  ])('is decided by %s', (_name, settings, expected) => {
    expect(wantsWeeklyEmail(settings)).toBe(expected)
  })
})

describe('groupByRecipient', () => {
  const one = summary('Alpha Brigade', [status('Alpha 1', 100)])
  const two = summary('Bravo Brigade', [status('Bravo 1', 0, false)])

  it('combines a VSO on two brigades into one entry', () => {
    const grouped = groupByRecipient([
      { summary: one, recipients: ['vso@x.nz'] },
      { summary: two, recipients: ['vso@x.nz'] },
    ])

    expect(grouped).toEqual([{ to: 'vso@x.nz', summaries: [one, two] }])
  })

  it('combines brigades sharing a Report Email into one entry', () => {
    const grouped = groupByRecipient([
      { summary: one, recipients: ['team@x.nz'] },
      { summary: two, recipients: ['team@x.nz', 'other@x.nz'] },
    ])

    expect(grouped).toEqual([
      { to: 'team@x.nz', summaries: [one, two] },
      { to: 'other@x.nz', summaries: [two] },
    ])
  })

  it('treats addresses case-insensitively without repeating a brigade', () => {
    const grouped = groupByRecipient([{ summary: one, recipients: ['VSO@x.nz', 'vso@x.nz'] }])

    expect(grouped).toEqual([{ to: 'vso@x.nz', summaries: [one] }])
  })
})

describe('renderWeeklyEmail', () => {
  const alpha = summary('Alpha Brigade', [status('Alpha 2', 33), status('Alpha 1', 100)])
  const bravo = summary('Bravo Brigade', [status('Bravo 1', 0, false)])

  function htmlRow(html: string, callsign: string): string {
    const row = new RegExp(`<tr[^>]*>(?:(?!</tr>).)*${callsign}.*?</tr>`, 's').exec(html)
    if (!row) throw new Error(`No row for ${callsign}`)
    return row[0]
  }

  function textRow(text: string, callsign: string): string {
    const row = text.split('\n').find((line) => line.includes(callsign))
    if (!row) throw new Error(`No row for ${callsign}`)
    return row
  }

  it('says how many appliances are incomplete, or that all are complete', () => {
    const incomplete = renderWeeklyEmail([alpha, bravo], PREVIOUS_CHECK, ADMIN_URL)
    const complete = renderWeeklyEmail([summary('Alpha Brigade', [status('Alpha 1', 100)])], PREVIOUS_CHECK, ADMIN_URL)

    expect(incomplete.subject).toBe('Appliance checks, Mon 21 Sep: 2 of 3 appliances incomplete')
    expect(complete.subject).toBe('Appliance checks, Mon 21 Sep: all complete')
  })

  it('sorts rows by brigade then Callsign, names each brigade once and marks flagged rows', () => {
    const { text, html } = renderWeeklyEmail([bravo, alpha], PREVIOUS_CHECK, ADMIN_URL)

    for (const body of [text, html]) {
      const order = ['Alpha 1', 'Alpha 2', 'Bravo 1'].map((callsign) => body.indexOf(callsign))
      expect(order).toEqual([...order].sort((a, b) => a - b))
      expect(body.split('Alpha Brigade')).toHaveLength(2)
      expect(body.split('Bravo Brigade')).toHaveLength(2)
      expect(body).toContain(ADMIN_URL)
    }

    expect(textRow(text, 'Alpha 2')).toMatch(/^!/)
    expect(textRow(text, 'Alpha 2')).toContain('33%')
    expect(textRow(text, 'Bravo 1')).toMatch(/^!.*not started/)
    expect(textRow(text, 'Alpha 1')).not.toMatch(/^!/)
    expect(textRow(text, 'Alpha 1')).toContain('Complete')
    expect(htmlRow(html, 'Alpha 2')).toContain('background')
    expect(htmlRow(html, 'Alpha 1')).not.toContain('background')
  })

  it('escapes brigade names in the HTML', () => {
    const { html } = renderWeeklyEmail([summary('Fire <b>Brigade', [status('Fire 1', 100)])], PREVIOUS_CHECK, ADMIN_URL)

    expect(html).toContain('Fire &lt;b&gt;Brigade')
    expect(html).not.toContain('<b>Brigade')
  })
})

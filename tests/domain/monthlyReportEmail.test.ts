import { describe, expect, it } from 'vitest'
import {
  alreadySent,
  monthlyReportRecipient,
  renderMonthlyReportEmail,
  shouldSend,
} from '../../src/domain/monthlyReportEmail'
import type { ApplianceStatus, BrigadeSummary } from '../../src/domain/weeklyEmail'

const LAST_CHECK = '2026-09-29'

function status(callsign: string, percent: number, started = true): ApplianceStatus {
  return { callsign, percent, started }
}

function summary(appliances: ApplianceStatus[], brigadeName = 'Mangawhai'): BrigadeSummary {
  return { brigadeName, appliances }
}

describe('shouldSend', () => {
  it('sends the day after the last Check once every Appliance is complete', () => {
    expect(shouldSend(summary([status('A 1', 100), status('A 2', 100)]), LAST_CHECK, '2026-09-30')).toBe(true)
  })

  it('waits while an Appliance is incomplete and the window is open', () => {
    expect(shouldSend(summary([status('A 1', 100), status('A 2', 80)]), LAST_CHECK, '2026-09-30')).toBe(false)
  })

  it('waits for an Appliance that is not started until the window closes', () => {
    expect(shouldSend(summary([status('A 1', 0, false)]), LAST_CHECK, '2026-10-05')).toBe(false)
  })

  it('sends incomplete Reports once the window has closed', () => {
    expect(shouldSend(summary([status('A 1', 80)]), LAST_CHECK, '2026-10-06')).toBe(true)
  })
})

describe('alreadySent', () => {
  it.each([
    ['the same month', '2026-09', '2026-09', true],
    ['a later month', '2026-09', '2026-10', true],
    ['an earlier month', '2026-09', '2026-08', false],
    ['no marker', '2026-09', undefined, false],
  ])('%s', (_label, month, lastSent, expected) => {
    expect(alreadySent(month, lastSent)).toBe(expected)
  })
})

describe('monthlyReportRecipient', () => {
  it('returns the trimmed, lower-cased address when enabled', () => {
    expect(monthlyReportRecipient({ enabled: true, email: ' X@Example.com ' })).toBe('x@example.com')
  })

  it.each([
    ['disabled', { enabled: false, email: 'x@example.com' }],
    ['a blank address', { enabled: true, email: '' }],
    ['an invalid address', { enabled: true, email: 'nope' }],
    ['no settings', {}],
  ])('returns null for %s', (_label, settings) => {
    expect(monthlyReportRecipient(settings)).toBeNull()
  })
})

describe('renderMonthlyReportEmail', () => {
  const mixed = summary([status('Mangawhai 1', 100), status('Mangawhai 2', 80)])

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

  it('names the brigade and month in the subject and body', () => {
    const { subject, text, html } = renderMonthlyReportEmail(mixed, LAST_CHECK)

    expect(subject).toBe('Monthly Reports: Mangawhai, September 2026')
    expect(text).toContain('Monthly Reports for September 2026 are attached.')
    expect(html).toContain('Monthly Reports for September 2026 are attached.')
  })

  it('highlights and marks incomplete Appliances, under the last Check date', () => {
    const { text, html } = renderMonthlyReportEmail(mixed, LAST_CHECK)

    expect(text).toContain('Last Check (Tue 29 Sep)')
    expect(html).toContain('Last Check (Tue 29 Sep)')
    expect(textRow(text, 'Mangawhai 2')).toMatch(/^!.*80%/)
    expect(textRow(text, 'Mangawhai 1')).not.toMatch(/^!/)
    expect(textRow(text, 'Mangawhai 1')).toContain('Complete')
    expect(htmlRow(html, 'Mangawhai 2')).toContain('background')
    expect(htmlRow(html, 'Mangawhai 1')).not.toContain('background')
  })

  it('escapes Callsigns in the HTML', () => {
    const { html } = renderMonthlyReportEmail(summary([status('<i>1', 100)]), LAST_CHECK)

    expect(html).toContain('&lt;i&gt;1')
    expect(html).not.toContain('<i>1')
  })
})

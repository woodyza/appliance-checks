import { describe, expect, it } from 'vitest'
import {
  type BrigadeDraft,
  normaliseBrigade,
  normaliseReportSettings,
  type ReportSettingsDraft,
} from '../../src/domain/brigade'

function draft(overrides: Partial<BrigadeDraft> = {}): BrigadeDraft {
  return { name: 'Mangawhai', checkDay: 2, active: true, ...overrides }
}

function settingsDraft(overrides: Partial<ReportSettingsDraft> = {}): ReportSettingsDraft {
  return {
    reportEmail: '',
    weeklyEmail: true,
    monthlyReportEnabled: false,
    monthlyReportEmail: '',
    ...overrides,
  }
}

describe('normaliseBrigade', () => {
  it('trims the name', () => {
    const result = normaliseBrigade(draft({ name: '  Mangawhai  ' }))

    expect(result).toEqual({ ok: true, brigade: { name: 'Mangawhai', checkDay: 2, active: true } })
  })

  it.each([
    ['a blank name', { name: '  ' }, 'Enter a name.'],
    ['a 61-character name', { name: 'x'.repeat(61) }, 'Keep the name to 60 characters.'],
    ['no Check Day', { checkDay: null }, 'Pick a Check Day.'],
  ])('rejects %s', (_label, overrides, problem) => {
    expect(normaliseBrigade(draft(overrides))).toEqual({ ok: false, problem })
  })
})

describe('normaliseReportSettings', () => {
  it('lower-cases and trims the Report Email', () => {
    const result = normaliseReportSettings(settingsDraft({ reportEmail: '  VSO@Example.COM ' }))

    expect(result).toEqual({
      ok: true,
      settings: { reportEmail: 'vso@example.com', weeklyEmail: true, monthlyReportEnabled: false, monthlyReportEmail: null },
    })
  })

  it('turns a blank Report Email into null', () => {
    const result = normaliseReportSettings(settingsDraft({ reportEmail: '   ' }))

    expect(result.ok && result.settings.reportEmail).toBeNull()
  })

  it.each([
    ['an invalid Report Email', { reportEmail: 'nope' }, 'Enter a valid Report Email, or leave it blank.'],
    [
      'a Report Email over 254 characters',
      { reportEmail: `${'x'.repeat(250)}@a.nz` },
      'Enter a valid Report Email, or leave it blank.',
    ],
    [
      'the Monthly Report ticked with a blank address',
      { monthlyReportEnabled: true, monthlyReportEmail: '  ' },
      'Add an address to email the Monthly Reports.',
    ],
    [
      'an invalid Monthly Report address',
      { monthlyReportEnabled: true, monthlyReportEmail: 'nope' },
      'Enter a valid Monthly Report email address.',
    ],
  ])('rejects %s', (_label, overrides, problem) => {
    expect(normaliseReportSettings(settingsDraft(overrides))).toEqual({ ok: false, problem })
  })

  it('keeps a valid Monthly Report address, lower-cased and trimmed, when unticked', () => {
    const result = normaliseReportSettings(settingsDraft({ monthlyReportEmail: ' Reports@Example.com ' }))

    expect(result.ok && result.settings).toMatchObject({
      monthlyReportEnabled: false,
      monthlyReportEmail: 'reports@example.com',
    })
  })

  it('turns a blank Monthly Report address into null when unticked', () => {
    const result = normaliseReportSettings(settingsDraft({ monthlyReportEmail: ' ' }))

    expect(result.ok && result.settings.monthlyReportEmail).toBeNull()
  })
})

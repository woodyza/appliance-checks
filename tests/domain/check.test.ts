import { describe, expect, it } from 'vitest'
import {
  answerFits,
  defaultCheckDate,
  isComplete,
  isCompleteAsRendered,
  isFrozen,
  mergeResponses,
  monthlyFor,
  previousValue,
  renderVersion,
  sectionProgress,
  selectorDates,
} from '../../src/domain/check'
import type { Check, CheckSheetVersion, Item, Section } from '../../src/domain/types'

const TORCH = 'aaa22222'
const LADDER = 'bbb22222'
const REGO = 'ccc22222'
const HOSE = 'ddd22222'

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
      items: [item({ id: HOSE, label: 'Hose', scope: 'monthly' })],
    },
  ]
}

function check(overrides: Partial<Check> = {}): Check {
  return {
    applianceId: '8011',
    scheduledDate: '2026-09-21',
    monthly: false,
    checkSheetVersion: 1,
    responses: {},
    ...overrides,
  }
}

function version(overrides: Partial<CheckSheetVersion> = {}): CheckSheetVersion {
  return { version: 1, createdAt: new Date(), origin: { type: 'editor' }, sections: sections(), ...overrides }
}

describe('answerFits', () => {
  const choice = item({ inputType: 'choice', options: ['Full', '¾'] })

  it.each([
    ['Y/N accepts Y', item(), 'Y', true],
    ['Y/N accepts N', item(), 'N', true],
    ['Y/N rejects other text', item(), 'Full', false],
    ['Y/N rejects undefined', item(), undefined, false],
    ['Choice accepts an option', choice, '¾', true],
    ['Choice rejects a non-option', choice, '½', false],
    ['Written accepts text', item({ inputType: 'written' }), 'Full', true],
    ['Written accepts Y', item({ inputType: 'written' }), 'Y', true],
    ['Written rejects empty', item({ inputType: 'written' }), '', false],
  ])('%s', (_name, subject, value, expected) => {
    expect(answerFits(subject, value)).toBe(expected)
  })
})

describe('sectionProgress', () => {
  it('hides Section B and shows 2 due Items in Section A on a weekly Check', () => {
    const progress = sectionProgress(sections(), {}, false)

    expect(progress).toHaveLength(1)
    expect(progress[0].section.title).toBe('Section A')
    expect(progress[0].due.map((due) => due.id)).toEqual([TORCH, REGO])
  })

  it('shows both Sections, with 3 due Items in Section A, on a monthly Check', () => {
    const progress = sectionProgress(sections(), {}, true)

    expect(progress.map((section) => section.section.title)).toEqual(['Section A', 'Section B'])
    expect(progress[0].due).toHaveLength(3)
  })

  it("doesn't count an answer that no longer fits its Item", () => {
    const sheet = [{ id: 's', title: 'S', items: [item({ inputType: 'yn' })] }]

    expect(sectionProgress(sheet, { [TORCH]: 'Full' }, false)[0].answered).toBe(0)
  })
})

describe('isComplete', () => {
  it('is true when every due Item is answered, including an N', () => {
    const responses = { [TORCH]: 'N', [REGO]: '31/12/26' }

    expect(isComplete(sections(), responses, false)).toBe(true)
  })

  it('is false when a due Item is missing', () => {
    const responses = { [TORCH]: 'Y' }

    expect(isComplete(sections(), responses, false)).toBe(false)
  })

  it('ignores answers for Items not in the version', () => {
    const responses = { [TORCH]: 'Y', 'stray-id': 'Y' }

    expect(isComplete(sections(), responses, false)).toBe(false)
  })
})

describe('isComplete and answers that no longer fit', () => {
  it('is false when the only answer to a due Choice Item is a removed option', () => {
    const sheet = [{ id: 's', title: 'S', items: [item({ inputType: 'choice', options: ['Full', 'Half'] })] }]

    expect(isComplete(sheet, { [TORCH]: '¾' }, false)).toBe(false)
  })
})

describe('isFrozen', () => {
  it('is true when Complete against the stamped version, window open', () => {
    const c = check({ scheduledDate: '2026-09-21', responses: { [TORCH]: 'Y', [REGO]: '31/12/26' } })

    expect(isFrozen(c, version(), '2026-09-22', 1)).toBe(true)
  })

  it('is true when incomplete but today is the window end', () => {
    const c = check({ scheduledDate: '2026-09-21', responses: {} })

    expect(isFrozen(c, version(), '2026-09-28', 1)).toBe(true)
  })

  it('is false when incomplete and today is the day before the window end', () => {
    const c = check({ scheduledDate: '2026-09-21', responses: {} })

    expect(isFrozen(c, version(), '2026-09-27', 1)).toBe(false)
  })
})

describe('isCompleteAsRendered', () => {
  const torchOnly = version({ version: 2, sections: [{ id: 's', title: 'S', items: [item({ id: TORCH })] }] })
  const c = check({ scheduledDate: '2026-09-21', responses: { [TORCH]: 'Y' } })

  it('scores a Check still in its window against the current version', () => {
    expect(isCompleteAsRendered(c, version(), torchOnly, '2026-09-27', 1)).toBe(true)
  })

  it('scores a Check past its window against its stamped version', () => {
    expect(isCompleteAsRendered(c, version(), torchOnly, '2026-09-28', 1)).toBe(false)
  })
})

describe('renderVersion', () => {
  it('returns the stamped version when Frozen', () => {
    expect(renderVersion(check({ checkSheetVersion: 3 }), true, 5)).toBe(3)
  })

  it('returns the current version when not Frozen', () => {
    expect(renderVersion(check({ checkSheetVersion: 3 }), false, 5)).toBe(5)
  })

  it('returns the current version when there is no Check yet', () => {
    expect(renderVersion(null, false, 5)).toBe(5)
  })
})

describe('monthlyFor', () => {
  it('uses the existing Check value even on a last-of-month date', () => {
    const c = check({ scheduledDate: '2026-09-28', monthly: false })

    expect(monthlyFor(c, '2026-09-28')).toBe(false)
  })

  it('computes it from the date when there is no Check yet', () => {
    expect(monthlyFor(null, '2026-09-28')).toBe(true)
  })
})

describe('defaultCheckDate', () => {
  const current = '2026-09-28'

  it('returns the current date when a Check already exists for it', () => {
    const existing = [{ scheduledDate: current, started: false, complete: false }]

    expect(defaultCheckDate(existing, current, current, 1, null)).toBe(current)
  })

  it('returns the previous Check date when it is started but not Complete', () => {
    const existing = [{ scheduledDate: '2026-09-21', started: true, complete: false }]

    expect(defaultCheckDate(existing, current, current, 1, null)).toBe('2026-09-21')
  })

  it('returns the current date when the previous Check was never started', () => {
    const existing = [{ scheduledDate: '2026-09-21', started: false, complete: false }]

    expect(defaultCheckDate(existing, current, current, 1, null)).toBe(current)
  })

  it('returns the current date when the previous Check is Complete', () => {
    const existing = [{ scheduledDate: '2026-09-21', started: true, complete: true }]

    expect(defaultCheckDate(existing, current, current, 1, null)).toBe(current)
  })

  it('returns the current date when there are no existing Checks', () => {
    expect(defaultCheckDate([], current, current, 1, null)).toBe(current)
  })

  it('returns a later existing Check still within its window after a Check Day change', () => {
    const existing = [{ scheduledDate: '2026-09-21', started: true, complete: false }]

    expect(defaultCheckDate(existing, '2026-09-17', '2026-09-22', 4, null)).toBe('2026-09-21')
  })

  it('returns the current date when the started, incomplete previous Check is not the immediately previous one', () => {
    const existing = [{ scheduledDate: '2026-09-07', started: true, complete: false }]

    expect(defaultCheckDate(existing, '2026-09-21', '2026-09-21', 1, null)).toBe('2026-09-21')
  })

  it('only considers the latest previous Check, not an earlier started one', () => {
    const existing = [
      { scheduledDate: '2026-09-07', started: true, complete: false },
      { scheduledDate: '2026-09-14', started: true, complete: true },
    ]

    expect(defaultCheckDate(existing, '2026-09-21', '2026-09-21', 1, null)).toBe('2026-09-21')
  })
})

describe('defaultCheckDate on an early day', () => {
  const current = '2026-10-05'
  const saturday = '2026-10-10'
  const upcoming = '2026-10-12'

  it('returns the upcoming Check once the current one is Complete', () => {
    const existing = [{ scheduledDate: current, started: true, complete: true }]

    expect(defaultCheckDate(existing, current, saturday, 1, upcoming)).toBe(upcoming)
  })

  it('returns the current Check while it is started but not Complete', () => {
    const existing = [{ scheduledDate: current, started: true, complete: false }]

    expect(defaultCheckDate(existing, current, saturday, 1, upcoming)).toBe(current)
  })

  it('returns the current Check when nobody has started it', () => {
    expect(defaultCheckDate([], current, saturday, 1, upcoming)).toBe(current)
  })

  it('returns the current Check when only the previous one is Complete', () => {
    const existing = [{ scheduledDate: '2026-09-28', started: true, complete: true }]

    expect(defaultCheckDate(existing, current, saturday, 1, upcoming)).toBe(current)
  })

  it('returns the current Check over an upcoming one already started', () => {
    const existing = [{ scheduledDate: upcoming, started: true, complete: false }]

    expect(defaultCheckDate(existing, current, saturday, 1, upcoming)).toBe(current)
  })

  it('returns the previous Check while it is started but not Complete and the current one is missing', () => {
    const existing = [{ scheduledDate: '2026-09-28', started: true, complete: false }]

    expect(defaultCheckDate(existing, current, saturday, 1, upcoming)).toBe('2026-09-28')
  })

  it('returns a Complete current Check when there is no upcoming Check yet', () => {
    const existing = [{ scheduledDate: current, started: true, complete: true }]

    expect(defaultCheckDate(existing, current, '2026-10-09', 1, null)).toBe(current)
  })
})

describe('selectorDates', () => {
  it('unions existing dates with computed Check Day dates after a Check Day change, sorted and de-duplicated', () => {
    const existingDates = ['2026-09-07', '2026-09-14']

    const result = selectorDates(existingDates, '2026-09-24', '2026-09-24', '2026-09-24', 4, null)

    expect(result).toEqual(['2026-09-03', '2026-09-07', '2026-09-10', '2026-09-14', '2026-09-17', '2026-09-24'])
  })

  it('spans from the default date month even when the current date is in a later month', () => {
    const result = selectorDates([], '2026-09-28', '2026-10-05', '2026-10-05', 1, null)

    expect(result).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'])
  })

  it('includes an existing Check still within its window even past the current date', () => {
    const result = selectorDates(['2026-09-21'], '2026-09-21', '2026-09-17', '2026-09-22', 4, null)

    expect(result).toEqual(['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-21'])
  })

  it('excludes an existing date after today', () => {
    const result = selectorDates(['2026-09-24'], '2026-09-17', '2026-09-17', '2026-09-22', 1, null)

    expect(result).toEqual(['2026-09-07', '2026-09-14'])
  })

  it('counts an existing date equal to a computed one once', () => {
    const result = selectorDates(['2026-09-14'], '2026-09-14', '2026-09-14', '2026-09-14', 1, null)

    expect(result).toEqual(['2026-09-07', '2026-09-14'])
  })

  it('excludes an existing date before the default date month', () => {
    const result = selectorDates(['2026-08-01'], '2026-09-14', '2026-09-14', '2026-09-14', 1, null)

    expect(result).toEqual(['2026-09-07', '2026-09-14'])
  })

  it('keeps the previous Check from the month before once the current Check is the default', () => {
    const result = selectorDates(['2026-09-25'], '2026-10-02', '2026-10-02', '2026-10-02', 5, null)

    expect(result).toEqual(['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02'])
  })

  it('includes the upcoming Check on an early day', () => {
    const result = selectorDates([], '2026-10-12', '2026-10-12', '2026-10-17', 1, '2026-10-19')

    expect(result).toEqual(['2026-10-05', '2026-10-12', '2026-10-19'])
  })

  it('includes an existing Check dated after today on an early day', () => {
    const result = selectorDates(['2026-10-18'], '2026-10-12', '2026-10-12', '2026-10-17', 1, '2026-10-19')

    expect(result).toEqual(['2026-10-05', '2026-10-12', '2026-10-18', '2026-10-19'])
  })

  it('spans from the current date month when the upcoming Check defaults into the next month', () => {
    const result = selectorDates([], '2026-11-02', '2026-10-26', '2026-10-31', 1, '2026-11-02')

    expect(result).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'])
  })
})

describe('previousValue', () => {
  const checks: Check[] = [
    check({ scheduledDate: '2026-09-07', responses: { [REGO]: '30/06/26' } }),
    check({ scheduledDate: '2026-09-14', responses: { [REGO]: '' } }),
    check({ scheduledDate: '2026-09-21', responses: {} }),
    check({ scheduledDate: '2026-09-28', responses: { [REGO]: '31/12/26' } }),
  ]

  it('walks back past a Check with no value and one with an empty string', () => {
    expect(previousValue(REGO, '2026-09-21', checks)).toBe('30/06/26')
  })

  it('ignores Checks on or after the selected date', () => {
    expect(previousValue(REGO, '2026-09-07', checks)).toBe(null)
  })

  it('returns null when no earlier Check has a value', () => {
    expect(previousValue('unknown-id', '2026-09-28', checks)).toBe(null)
  })

  it('prefers the nearer of two earlier non-empty values', () => {
    const twoValues: Check[] = [
      check({ scheduledDate: '2026-09-07', responses: { [REGO]: '30/06/26' } }),
      check({ scheduledDate: '2026-09-14', responses: { [REGO]: '31/07/26' } }),
    ]

    expect(previousValue(REGO, '2026-09-21', twoValues)).toBe('31/07/26')
  })
})

describe('mergeResponses', () => {
  it('takes the fresh value for a non-pending Item', () => {
    const result = mergeResponses({ [TORCH]: 'N' }, { [TORCH]: 'Y' }, new Set())

    expect(result).toEqual({ [TORCH]: 'Y' })
  })

  it('keeps the local value for a pending Item even when fresh differs', () => {
    const result = mergeResponses({ [TORCH]: 'N' }, { [TORCH]: 'Y' }, new Set([TORCH]))

    expect(result).toEqual({ [TORCH]: 'N' })
  })

  it('keeps a pending Item cleared locally absent even when fresh has a value', () => {
    const result = mergeResponses({}, { [TORCH]: 'Y' }, new Set([TORCH]))

    expect(result).toEqual({})
  })
})

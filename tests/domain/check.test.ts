import { describe, expect, it } from 'vitest'
import {
  defaultCheckDate,
  isComplete,
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

    expect(defaultCheckDate(existing, current, current, 1)).toBe(current)
  })

  it('returns the previous Check date when it is started but not Complete', () => {
    const existing = [{ scheduledDate: '2026-09-21', started: true, complete: false }]

    expect(defaultCheckDate(existing, current, current, 1)).toBe('2026-09-21')
  })

  it('returns the current date when the previous Check was never started', () => {
    const existing = [{ scheduledDate: '2026-09-21', started: false, complete: false }]

    expect(defaultCheckDate(existing, current, current, 1)).toBe(current)
  })

  it('returns the current date when the previous Check is Complete', () => {
    const existing = [{ scheduledDate: '2026-09-21', started: true, complete: true }]

    expect(defaultCheckDate(existing, current, current, 1)).toBe(current)
  })

  it('returns the current date when there are no existing Checks', () => {
    expect(defaultCheckDate([], current, current, 1)).toBe(current)
  })

  it('returns a later existing Check still within its window after a Check Day change', () => {
    const existing = [{ scheduledDate: '2026-09-21', started: true, complete: false }]

    expect(defaultCheckDate(existing, '2026-09-17', '2026-09-22', 4)).toBe('2026-09-21')
  })

  it('returns the current date when the started, incomplete previous Check is not the immediately previous one', () => {
    const existing = [{ scheduledDate: '2026-09-07', started: true, complete: false }]

    expect(defaultCheckDate(existing, '2026-09-21', '2026-09-21', 1)).toBe('2026-09-21')
  })

  it('only considers the latest previous Check, not an earlier started one', () => {
    const existing = [
      { scheduledDate: '2026-09-07', started: true, complete: false },
      { scheduledDate: '2026-09-14', started: true, complete: true },
    ]

    expect(defaultCheckDate(existing, '2026-09-21', '2026-09-21', 1)).toBe('2026-09-21')
  })
})

describe('selectorDates', () => {
  it('unions existing dates with computed Check Day dates after a Check Day change, sorted and de-duplicated', () => {
    const existingDates = ['2026-09-07', '2026-09-14']

    const result = selectorDates(existingDates, '2026-09-24', '2026-09-24', '2026-09-24', 4)

    expect(result).toEqual(['2026-09-03', '2026-09-07', '2026-09-10', '2026-09-14', '2026-09-17', '2026-09-24'])
  })

  it('spans from the default date month even when the current date is in a later month', () => {
    const result = selectorDates([], '2026-09-28', '2026-10-05', '2026-10-05', 1)

    expect(result).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'])
  })

  it('includes an existing Check still within its window even past the current date', () => {
    const result = selectorDates(['2026-09-21'], '2026-09-21', '2026-09-17', '2026-09-22', 4)

    expect(result).toEqual(['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-21'])
  })

  it('excludes an existing date after today', () => {
    const result = selectorDates(['2026-09-24'], '2026-09-17', '2026-09-17', '2026-09-22', 1)

    expect(result).toEqual(['2026-09-07', '2026-09-14'])
  })

  it('counts an existing date equal to a computed one once', () => {
    const result = selectorDates(['2026-09-14'], '2026-09-14', '2026-09-14', '2026-09-14', 1)

    expect(result).toEqual(['2026-09-07', '2026-09-14'])
  })

  it('excludes an existing date before the default date month', () => {
    const result = selectorDates(['2026-08-01'], '2026-09-14', '2026-09-14', '2026-09-14', 1)

    expect(result).toEqual(['2026-09-07', '2026-09-14'])
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

import { describe, expect, it } from 'vitest'
import {
  checkDatesBetween,
  currentCheckDate,
  firstOfPreviousMonth,
  isLastOfMonth,
  nextCheckDate,
  today,
} from '../../src/domain/schedule'

describe('today', () => {
  it('crosses the UTC day boundary at NZDT (+13)', () => {
    expect(today(new Date('2026-03-31T11:30:00Z'))).toBe('2026-04-01')
  })

  it('stays on the UTC day when NZDT has not yet crossed midnight', () => {
    expect(today(new Date('2026-03-31T10:30:00Z'))).toBe('2026-03-31')
  })
})

describe('currentCheckDate', () => {
  it('returns the date itself on a Check Day', () => {
    expect(currentCheckDate('2026-09-21', 1)).toBe('2026-09-21')
  })

  it('returns the previous Check Day the day after', () => {
    expect(currentCheckDate('2026-09-22', 1)).toBe('2026-09-21')
  })

  it('returns the last Check Day of the previous month before the first Check Day of a new month', () => {
    expect(currentCheckDate('2026-10-01', 1)).toBe('2026-09-28')
  })
})

describe('nextCheckDate', () => {
  it('returns the next occurrence of the same Check Day', () => {
    expect(nextCheckDate('2026-09-21', 1)).toBe('2026-09-28')
  })

  it('returns the next occurrence of a changed Check Day', () => {
    expect(nextCheckDate('2026-09-21', 4)).toBe('2026-09-24')
  })
})

describe('isLastOfMonth', () => {
  it('is true only for the 5th Monday in a 5-Monday month', () => {
    expect(isLastOfMonth('2026-06-29')).toBe(true)
    expect(isLastOfMonth('2026-06-22')).toBe(false)
  })

  it('is true only for the 4th Monday in a 4-Monday month', () => {
    expect(isLastOfMonth('2026-09-28')).toBe(true)
    expect(isLastOfMonth('2026-09-21')).toBe(false)
  })
})

describe('firstOfPreviousMonth', () => {
  it('crosses a year boundary in January', () => {
    expect(firstOfPreviousMonth('2026-01-15')).toBe('2025-12-01')
  })

  it('returns the 1st of the previous month otherwise', () => {
    expect(firstOfPreviousMonth('2026-03-31')).toBe('2026-02-01')
  })
})

describe('checkDatesBetween', () => {
  it('returns every Check Day date in the range, ascending', () => {
    expect(checkDatesBetween('2026-09-01', '2026-09-21', 1)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21'])
  })
})

import { describe, expect, it } from 'vitest'
import { applianceIdProblem, callsignProblem, suggestApplianceId } from '../../src/domain/appliance'

const FORMAT_MESSAGE = 'Use letters, digits, - or _, up to 32 characters.'

describe('suggestApplianceId', () => {
  it.each([
    ['Mangawhai 8011', '8011'],
    ['Pump', ''],
    ['Rescue 2 ', '2'],
  ])('suggests %j as %j', (callsign, expected) => {
    expect(suggestApplianceId(callsign)).toBe(expected)
  })
})

describe('applianceIdProblem', () => {
  it.each(['8011', 'a_b-C', 'Admin'])('accepts %j', (id) => {
    expect(applianceIdProblem(id)).toBeNull()
  })

  it.each(['', 'x'.repeat(33), 'a b', 'a/b'])('rejects %j with the format message', (id) => {
    expect(applianceIdProblem(id)).toBe(FORMAT_MESSAGE)
  })

  it('rejects admin', () => {
    expect(applianceIdProblem('admin')).toBe('"admin" can\'t be used as an id.')
  })
})

describe('callsignProblem', () => {
  it.each(['  ', 'x'.repeat(61)])('rejects %j', (callsign) => {
    expect(callsignProblem(callsign)).toBe('A Callsign is 1–60 characters.')
  })

  it('accepts 60 characters', () => {
    expect(callsignProblem('x'.repeat(60))).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { superadminUidFromResponse } from '../../../cli/lib/superadmin'

describe('superadminUidFromResponse', () => {
  it('returns undefined when the doc does not exist', () => {
    expect(superadminUidFromResponse(404, '{"error":{"status":"NOT_FOUND"}}')).toBeUndefined()
  })

  it('returns the stored uid', () => {
    const body = JSON.stringify({ fields: { uid: { stringValue: 'abc' } } })
    expect(superadminUidFromResponse(200, body)).toBe('abc')
  })

  it('throws when the doc has no uid', () => {
    expect(() => superadminUidFromResponse(200, JSON.stringify({ fields: {} }))).toThrow(/uid/)
  })

  it('throws on any other status rather than reporting no superadmin', () => {
    expect(() => superadminUidFromResponse(403, 'denied')).toThrow(/403.*denied/)
  })
})

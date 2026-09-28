import { describe, expect, it } from 'vitest'
import { type AdminUserDraft, normaliseAdminUser } from '../../src/domain/adminUser'

function draft(overrides: Partial<AdminUserDraft> = {}): AdminUserDraft {
  return { email: 'jo@example.com', displayName: '', role: 'brigadeAdmin', brigadeIds: ['b1'], ...overrides }
}

describe('normaliseAdminUser', () => {
  it('trims and lower-cases the email, and turns a blank display name into null', () => {
    const result = normaliseAdminUser(draft({ email: '  Jo@Example.COM ', displayName: '  ' }))

    expect(result).toEqual({
      ok: true,
      user: { email: 'jo@example.com', displayName: null, role: 'brigadeAdmin', brigadeIds: ['b1'] },
    })
  })

  it('rejects an email without a single @ with text either side', () => {
    expect(normaliseAdminUser(draft({ email: 'jo' }))).toEqual({ ok: false, problem: 'Enter an email address.' })
  })

  it.each([[[]], [['b1', 'b2']]])(
    'rejects a Brigade Admin with brigadeIds %j',
    (brigadeIds) => {
      expect(normaliseAdminUser(draft({ role: 'brigadeAdmin', brigadeIds }))).toEqual({
        ok: false,
        problem: 'A Brigade Admin has exactly one brigade.',
      })
    },
  )

  it('rejects a VSO with no brigades', () => {
    expect(normaliseAdminUser(draft({ role: 'vso', brigadeIds: [] }))).toEqual({
      ok: false,
      problem: 'Pick at least one brigade.',
    })
  })

  it('dedupes a VSO brigade list', () => {
    const result = normaliseAdminUser(draft({ role: 'vso', brigadeIds: ['b1', 'b2', 'b1'] }))

    expect(result).toEqual({
      ok: true,
      user: { email: 'jo@example.com', displayName: null, role: 'vso', brigadeIds: ['b1', 'b2'] },
    })
  })
})

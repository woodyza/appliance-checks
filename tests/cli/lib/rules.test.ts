import { describe, expect, it } from 'vitest'
import { substituteSuperadmin } from '../../../cli/lib/rules'

const RULES = "function isSuperadmin() {\n  return request.auth.uid == 'emulator-superadmin';\n}\n"

describe('substituteSuperadmin', () => {
  it('replaces the literal with the given UID', () => {
    expect(substituteSuperadmin(RULES, 'abc123')).toContain("request.auth.uid == 'abc123'")
  })

  it("substitutes '' when no UID is given", () => {
    expect(substituteSuperadmin(RULES, undefined)).toContain("request.auth.uid == ''")
  })

  it('throws on a UID that is not letters and digits', () => {
    expect(() => substituteSuperadmin(RULES, "abc' || true || '")).toThrow()
  })

  it('throws when the literal is missing', () => {
    expect(() => substituteSuperadmin('no literal here', 'abc123')).toThrow()
  })

  it('throws when the literal is duplicated', () => {
    const duplicated = `${RULES}${RULES}`

    expect(() => substituteSuperadmin(duplicated, 'abc123')).toThrow()
  })
})

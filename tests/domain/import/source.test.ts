import { describe, expect, it } from 'vitest'
import { ImportError } from '../../../src/domain/import/errors'
import { resolveSpreadsheetId } from '../../../src/domain/import/source'
import type { CheckSheetVersion } from '../../../src/domain/types'

function versionWith(origin: CheckSheetVersion['origin']): CheckSheetVersion {
  return { version: 1, createdAt: new Date('2026-03-01'), origin, sections: [] }
}

describe('resolveSpreadsheetId', () => {
  it('uses the flag when given, even with an import-origin current version', () => {
    const current = versionWith({ type: 'import', spreadsheetId: 'current-sheet' })

    expect(resolveSpreadsheetId(current, 'flag-sheet')).toBe('flag-sheet')
  })

  it("uses the current version's spreadsheetId when no flag is given and the origin is import", () => {
    const current = versionWith({ type: 'import', spreadsheetId: 'current-sheet' })

    expect(resolveSpreadsheetId(current)).toBe('current-sheet')
  })

  it('throws ImportError when there is no current version and no flag', () => {
    expect(() => resolveSpreadsheetId(null)).toThrow(ImportError)
  })

  it('throws ImportError mentioning the editor when the current version has an editor origin and no flag', () => {
    const current = versionWith({ type: 'editor' })

    expect(() => resolveSpreadsheetId(current)).toThrow(/editor/i)
  })
})

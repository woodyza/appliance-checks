import { describe, expect, it } from 'vitest'
import { ImportError } from '../../../src/domain/import/errors'
import { importPrefill, parseSpreadsheetId, resolveSpreadsheetId } from '../../../src/domain/import/source'
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

describe('parseSpreadsheetId', () => {
  it('pulls the id out of a sheet URL', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/AbC_12-x/edit#gid=0')).toBe('AbC_12-x')
  })

  it('accepts a bare id, trimmed', () => {
    expect(parseSpreadsheetId('AbC_12-x')).toBe('AbC_12-x')
    expect(parseSpreadsheetId('  AbC  ')).toBe('AbC')
  })

  it.each(['https://example.com/foo', ''])('returns null for %j', (input) => {
    expect(parseSpreadsheetId(input)).toBeNull()
  })
})

describe('importPrefill', () => {
  const imported = (spreadsheetId: string): CheckSheetVersion['origin'] => ({ type: 'import', spreadsheetId })

  it("uses the draft's import id", () => {
    expect(importPrefill(imported('draft'), imported('current'))).toBe('draft')
  })

  it("falls back to the current version's id when the draft origin is editor", () => {
    expect(importPrefill({ type: 'editor' }, imported('current'))).toBe('current')
  })

  it('uses the current id when there is no draft', () => {
    expect(importPrefill(null, imported('current'))).toBe('current')
  })

  it('is empty when neither is an import', () => {
    expect(importPrefill({ type: 'editor' }, null)).toBe('')
  })
})

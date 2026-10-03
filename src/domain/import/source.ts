import type { CheckSheetOrigin, CheckSheetVersion } from '../types'
import { ImportError } from './errors'

export function resolveSpreadsheetId(current: CheckSheetVersion | null, flag?: string): string {
  if (flag) return flag

  if (current === null) {
    throw new ImportError(
      '--spreadsheet is required: there is no current Check Sheet version to read a spreadsheet id from.',
    )
  }

  if (current.origin.type === 'import') {
    return current.origin.spreadsheetId
  }

  throw new ImportError(
    '--spreadsheet is required: the current Check Sheet version was created in the editor, not imported from a spreadsheet.',
  )
}

export function parseSpreadsheetId(input: string): string | null {
  const trimmed = input.trim()
  const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(trimmed)
  if (fromUrl) return fromUrl[1]
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null
}

export function importPrefill(draftOrigin: CheckSheetOrigin | null, currentOrigin: CheckSheetOrigin | null): string {
  const origin = [draftOrigin, currentOrigin].find((candidate) => candidate?.type === 'import')
  return origin?.type === 'import' ? origin.spreadsheetId : ''
}

import type { CheckSheetVersion } from '../types'
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

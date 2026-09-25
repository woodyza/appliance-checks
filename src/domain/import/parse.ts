import type { ParsedCheckSheet, ParsedItem, ParsedSection } from '../types'
import { ImportError } from './errors'
import { normalise } from './normalise'
import type { SheetCellData, SheetGrid } from './sheetGrid'

const LABEL_COL = 0
const QTY_COL = 1
const DATA_COL_START = 2
const MONTHLY_BACKGROUND = '#434343'
const DEFECTS_MARKERS = ['MISSING', 'DEFECTS', 'ISSUES']

function rowsOf(grid: SheetGrid): SheetCellData[][] {
  const rowData = grid.sheets[0]?.data?.[0]?.rowData ?? []
  return rowData.map((rowEntry) => rowEntry.values ?? [])
}

function cellText(row: SheetCellData[], col: number): string {
  return row[col]?.formattedValue ?? ''
}

function stripToLetters(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z]/g, '')
}

function findYColumn(row: SheetCellData[]): number | null {
  for (let col = DATA_COL_START; col < row.length - 1; col++) {
    if (stripToLetters(cellText(row, col)) === 'Y' && stripToLetters(cellText(row, col + 1)) === 'N') {
      return col
    }
  }
  return null
}

function isDefectsMarkerRow(label: string): boolean {
  const upper = label.toUpperCase()
  return DEFECTS_MARKERS.every((marker) => upper.includes(marker))
}

function colorToHex(cell: SheetCellData): string {
  const rgb = cell.effectiveFormat?.backgroundColorStyle?.rgbColor ?? cell.effectiveFormat?.backgroundColor ?? {}
  const channel = (value: number | undefined): string =>
    Math.round((value ?? 0) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(rgb.red)}${channel(rgb.green)}${channel(rgb.blue)}`
}

function parseItem(row: SheetCellData[], yColumn: number, label: string, rawQty: string): ParsedItem {
  const qty = rawQty.trim() === '' ? null : rawQty.trim()
  const yCell: SheetCellData | undefined = row[yColumn]
  const condition = yCell?.dataValidation?.condition

  let inputType: ParsedItem['inputType'] = 'written'
  let options: string[] | undefined
  if (condition?.type === 'BOOLEAN') {
    inputType = 'yn'
  } else if (condition?.type === 'ONE_OF_LIST') {
    inputType = 'choice'
    options = (condition.values ?? []).map((value) => value.userEnteredValue ?? '')
  }

  const scope: ParsedItem['scope'] =
    inputType === 'yn' && yCell !== undefined && colorToHex(yCell) === MONTHLY_BACKGROUND ? 'monthly' : 'weekly'

  return options === undefined ? { label, qty, inputType, scope } : { label, qty, inputType, options, scope }
}

export function parseCheckSheet(grid: SheetGrid): ParsedCheckSheet {
  const rows = rowsOf(grid)

  let headerRowIndex = -1
  let yColumn: number | null = null
  for (let r = 0; r < rows.length; r++) {
    if (cellText(rows[r], QTY_COL).trim().toLowerCase() !== 'quantity') continue
    headerRowIndex = r
    yColumn = findYColumn(rows[r])
    break
  }

  if (headerRowIndex === -1) {
    throw new ImportError('No Section header found: expected a row with "Quantity" in column B.')
  }
  if (yColumn === null) {
    throw new ImportError('The first "Quantity" row has no Y/N column pair.')
  }

  const sections: ParsedSection[] = []
  const sectionTitlesSeen = new Set<string>()
  let currentSection: ParsedSection | null = null
  let itemLabelsSeenInSection = new Set<string>()

  for (let r = headerRowIndex; r < rows.length; r++) {
    const row = rows[r]
    const label = cellText(row, LABEL_COL).trim()
    const qty = cellText(row, QTY_COL).trim()

    if (qty.toLowerCase() === 'quantity' && !label) {
      throw new ImportError(`Row ${r + 1} has "Quantity" in column B but no Section title in column A.`)
    }
    if (!label) continue
    if (isDefectsMarkerRow(label)) break

    if (qty.toLowerCase() === 'quantity') {
      const key = normalise(label)
      if (sectionTitlesSeen.has(key)) {
        throw new ImportError(`Duplicate Section title: "${label}"`)
      }
      sectionTitlesSeen.add(key)
      currentSection = { title: label, items: [] }
      itemLabelsSeenInSection = new Set<string>()
      sections.push(currentSection)
      continue
    }

    if (!currentSection) continue

    const itemKey = normalise(label)
    if (itemLabelsSeenInSection.has(itemKey)) {
      throw new ImportError(`Duplicate Item "${label}" in Section "${currentSection.title}"`)
    }
    itemLabelsSeenInSection.add(itemKey)

    currentSection.items.push(parseItem(row, yColumn, label, qty))
  }

  return { sections }
}

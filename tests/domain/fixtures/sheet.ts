import type { SheetCellData, SheetGrid } from '../../../src/domain/import/sheetGrid'

export function plainCell(value = ''): SheetCellData {
  return value === '' ? {} : { formattedValue: value }
}

export function ynCell(options: { monthly?: boolean; deprecatedColorField?: boolean } = {}): SheetCellData {
  const cell: SheetCellData = { dataValidation: { condition: { type: 'BOOLEAN' } } }
  if (options.monthly) {
    const rgbColor = { red: 0.2627, green: 0.2627, blue: 0.2627 }
    cell.effectiveFormat = options.deprecatedColorField
      ? { backgroundColor: rgbColor }
      : { backgroundColorStyle: { rgbColor } }
  }
  return cell
}

export function ynCellWithColor(color: SheetCellData['effectiveFormat']): SheetCellData {
  return { dataValidation: { condition: { type: 'BOOLEAN' } }, effectiveFormat: color }
}

export function listCell(options: string[]): SheetCellData {
  return {
    dataValidation: {
      condition: { type: 'ONE_OF_LIST', values: options.map((value) => ({ userEnteredValue: value })) },
    },
  }
}

export function row(label: string, qty: string, ...dataCells: SheetCellData[]): SheetCellData[] {
  return [plainCell(label), plainCell(qty), ...dataCells]
}

export function headerRow(title: string, columnsBeforePair = 0, yText = 'Y', nText = 'N'): SheetCellData[] {
  const filler = Array.from({ length: columnsBeforePair }, () => plainCell())
  return row(title, 'Quantity', ...filler, plainCell(yText), plainCell(nText))
}

export function grid(rows: SheetCellData[][]): SheetGrid {
  return { sheets: [{ data: [{ rowData: rows.map((values) => ({ values })) }] }] }
}

export function marchFixture(): SheetGrid {
  return grid([
    row('Mangawhai 8011 Truck Checks', ''),
    row('Rego: ABC123', ''),
    row('', '', plainCell('12/03/26')),
    headerRow('Cab'),
    row('Torch', '1', ynCell()),
    row('Fire extinguisher', '1', ynCell({ monthly: true })),
    row('FUEL', 'FUEL', listCell(['1/4', '1/2', '3/4', 'FULL'])),
    row('Documents', 'Quantity'),
    row('Rego expiry', '', plainCell()),
    row('MISSING - DEFECTS - ISSUES Write Below', ''),
    row('Reported by driver', ''),
  ])
}

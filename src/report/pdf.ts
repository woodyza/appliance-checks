import type { jsPDF } from 'jspdf'
import type { CellDef, CellInput, RowInput } from 'jspdf-autotable'
import { monthLabel, monthlyReportFilename } from '../domain/report'
import type { MonthlyReport, ReportCell, ReportColumn, ReportRow, ReportSection } from '../domain/report'
import { formatDateTime } from '../domain/schedule'

const PAGE_WIDTH_MM = 210
const PAGE_MARGIN_MM = 10
const LABEL_WIDTH_MM = 70
const QTY_WIDTH_MM = 14
const FONT_SIZE = 7

type Fill = [number, number, number]

const GREY: Fill = [224, 224, 224]
const NOT_DUE_FILL: Fill = [90, 90, 90]
const NA_FILL: Fill = [235, 235, 235]

// Light tints so the black X and text stay legible, and the X marks still carry the answer on a
// greyscale print.
const GOOD_FILL: Fill = [198, 239, 206]
const BAD_FILL: Fill = [255, 199, 206]
const MISSING_FILL: Fill = [255, 235, 156]

// jsPDF's built-in Helvetica only covers WinAnsi, so macrons (Taupō, Ōtaki) would otherwise be
// dropped: fall back to the base letter.
export function pdfText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '')
}

function formatShortDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year.slice(2)}`
}

// 5 Checks gives about 21mm a pair, as in the March PDF; fewer widen them, and more (after a
// Check Day change) narrow them rather than run off the page.
function pairWidthMm(columns: number): number {
  const available = PAGE_WIDTH_MM - PAGE_MARGIN_MM * 2 - LABEL_WIDTH_MM - QTY_WIDTH_MM
  return available / Math.max(columns, 1)
}

function statusLabel(column: ReportColumn): string {
  if (!column.check) return 'not started'
  return column.percent === 100 ? 'Complete' : `${String(column.percent)}%`
}

// The status colour of each rendered cell of a report cell (see `dateCells`): a Y/N answer
// shades only the column it landed in, anything due but unanswered is amber across the lot.
export function cellFills(cell: ReportCell): (Fill | undefined)[] {
  switch (cell.kind) {
    case 'yn':
      if (cell.value === 'Y') return [GOOD_FILL, undefined]
      if (cell.value === 'N') return [undefined, BAD_FILL]
      return [MISSING_FILL, MISSING_FILL]
    case 'value':
      return [cell.value === null ? MISSING_FILL : undefined]
    case 'na':
    case 'notDue':
      return [undefined]
  }
}

export function footerFill(column: ReportColumn): Fill {
  return column.check && column.percent === 100 ? GOOD_FILL : MISSING_FILL
}

function fillStyle(fill: Fill | undefined): { fillColor?: Fill } {
  return fill ? { fillColor: fill } : {}
}

// A `yn`/`value`/`na`/`notDue` cell renders as one or two entries in the row's cell array: `yn`
// needs its own Y and N sub-cells, the rest span both, per the design's cell rendering rules.
export function dateCells(cell: ReportCell): CellInput[] {
  const [first, second] = cellFills(cell)
  switch (cell.kind) {
    case 'yn':
      return [
        { content: cell.value === 'Y' ? 'X' : '', styles: fillStyle(first) },
        { content: cell.value === 'N' ? 'X' : '', styles: fillStyle(second) },
      ]
    case 'na':
      return [{ content: 'n/a', colSpan: 2, styles: { fillColor: NA_FILL, halign: 'center' } }]
    case 'notDue':
      return [{ content: '', colSpan: 2, styles: { fillColor: NOT_DUE_FILL } }]
    case 'value':
      return [{ content: pdfText(cell.value ?? ''), colSpan: 2, styles: { halign: 'center', ...fillStyle(first) } }]
  }
}

function sectionHeaderRow(section: ReportSection, columns: ReportColumn[]): RowInput {
  return [
    { content: pdfText(section.title), styles: { fillColor: GREY, fontStyle: 'bold' } },
    { content: 'Qty', styles: { fillColor: GREY } },
    ...columns.flatMap((): CellDef[] => [
      { content: 'Y', styles: { fillColor: GREY, halign: 'center' } },
      { content: 'N', styles: { fillColor: GREY, halign: 'center' } },
    ]),
  ]
}

function itemRow(row: ReportRow, columns: ReportColumn[]): RowInput {
  return [
    { content: pdfText(row.item.label) },
    { content: pdfText(row.item.qty ?? '') },
    ...columns.flatMap((_column, index) => dateCells(row.cells[index])),
  ]
}

function headRow(columns: ReportColumn[]): RowInput {
  return [
    { content: '' },
    { content: '' },
    ...columns.map(
      (column): CellDef => ({
        content: `${formatShortDate(column.date)}\nv${String(column.version)}`,
        colSpan: 2,
        styles: { halign: 'center' },
      }),
    ),
  ]
}

export function footRow(columns: ReportColumn[]): RowInput {
  return [
    { content: '', colSpan: 2 },
    ...columns.map(
      (column): CellDef => ({
        content: statusLabel(column),
        colSpan: 2,
        styles: { halign: 'center', fontStyle: 'bold', fillColor: footerFill(column) },
      }),
    ),
  ]
}

export async function buildMonthlyReportPdf(report: MonthlyReport, generatedAt: Date): Promise<jsPDF> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  doc.setFontSize(11)
  doc.text(pdfText(report.brigadeName), PAGE_MARGIN_MM, PAGE_MARGIN_MM)
  doc.text(pdfText(report.callsign), PAGE_MARGIN_MM, PAGE_MARGIN_MM + 5)
  doc.text(monthLabel(report.month), PAGE_MARGIN_MM, PAGE_MARGIN_MM + 10)

  const pairWidth = pairWidthMm(report.columns.length)
  const columnStyles: Record<string, { cellWidth: number }> = {
    '0': { cellWidth: LABEL_WIDTH_MM },
    '1': { cellWidth: QTY_WIDTH_MM },
  }
  for (let index = 0; index < report.columns.length * 2; index++) {
    columnStyles[String(index + 2)] = { cellWidth: pairWidth / 2 }
  }

  const body = report.sections.flatMap((section) => [
    sectionHeaderRow(section, report.columns),
    ...section.rows.map((row) => itemRow(row, report.columns)),
  ])

  autoTable(doc, {
    startY: PAGE_MARGIN_MM + 14,
    margin: { left: PAGE_MARGIN_MM, right: PAGE_MARGIN_MM },
    theme: 'grid',
    styles: { fontSize: FONT_SIZE, cellPadding: 1, lineColor: [180, 180, 180], lineWidth: 0.1, overflow: 'linebreak' },
    // Plain white head and foot; the foot's status cells carry their own colour.
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
    footStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
    head: [headRow(report.columns)],
    body,
    foot: [footRow(report.columns)],
    showFoot: 'lastPage',
    columnStyles,
  })

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? PAGE_MARGIN_MM + 14
  doc.setFontSize(8)
  doc.text(`Generated ${formatDateTime(generatedAt)}`, PAGE_MARGIN_MM, finalY + 6)

  return doc
}

export async function downloadMonthlyReport(report: MonthlyReport, generatedAt: Date): Promise<void> {
  const doc = await buildMonthlyReportPdf(report, generatedAt)
  doc.save(monthlyReportFilename(report.callsign, report.month))
}

import type { jsPDF } from 'jspdf'
import { fitTitle, qrSheetFilename, qrSheetTitle } from '../domain/qrSheet'
import { pdfText } from './pdf'

const PAGE_WIDTH_MM = 210
const PAGE_MARGIN_MM = 20
const MM_PER_PT = 25.4 / 72
const LINE_HEIGHT_FACTOR = 1.15
const TITLE_TOP_MM = 45
const QR_TOP_MM = 75
const QR_SIZE_MM = 140
const QUIET_ZONE_SQUARES = 4
const SEAM_OVERLAP_MM = 0.1
const URL_GREY: [number, number, number] = [110, 110, 110]

// Returns the size of one square, in mm.
function drawQrCode(doc: jsPDF, url: string, qrcode: typeof import('qrcode-generator')): number {
  // Level Q still scans with about a quarter of the code dirty or damaged.
  const qr = qrcode(0, 'Q')
  qr.addData(url)
  qr.make()

  const count = qr.getModuleCount()
  const module = QR_SIZE_MM / count
  const left = (PAGE_WIDTH_MM - QR_SIZE_MM) / 2
  doc.setFillColor(0, 0, 0)
  // One rect per run of dark squares, each overlapping the row below, so viewers don't show hairline
  // seams between neighbours.
  for (let row = 0; row < count; row++) {
    let col = 0
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col++
        continue
      }
      const start = col
      while (col < count && qr.isDark(row, col)) col++
      doc.rect(left + start * module, QR_TOP_MM + row * module, (col - start) * module, module + SEAM_OVERLAP_MM, 'F')
    }
  }
  return module
}

export async function buildQrSheetPdf(brigadeName: string, url: string): Promise<jsPDF> {
  const [{ jsPDF }, { default: qrcode }] = await Promise.all([import('jspdf'), import('qrcode-generator')])

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const centre = PAGE_WIDTH_MM / 2

  doc.setFont('helvetica', 'bold')
  const title = fitTitle(
    pdfText(qrSheetTitle(brigadeName)),
    PAGE_WIDTH_MM - PAGE_MARGIN_MM * 2,
    (text, fontSize) => doc.getStringUnitWidth(text) * fontSize * MM_PER_PT,
  )
  doc.setFontSize(title.fontSize)
  // A second line sits above the first's baseline, so the title grows upwards away from the code.
  const lineHeight = title.fontSize * MM_PER_PT * LINE_HEIGHT_FACTOR
  doc.text(title.lines, centre, TITLE_TOP_MM - lineHeight * (title.lines.length - 1), {
    align: 'center',
    lineHeightFactor: LINE_HEIGHT_FACTOR,
  })

  const module = drawQrCode(doc, url, qrcode)

  // Scanners need a blank margin of 4 squares around the code.
  const textTop = QR_TOP_MM + QR_SIZE_MM + QUIET_ZONE_SQUARES * module
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(18)
  doc.text('Scan to start a Check', centre, textTop, { align: 'center', baseline: 'top' })
  doc.setFontSize(11)
  doc.setTextColor(...URL_GREY)
  doc.text(url, centre, textTop + 11, { align: 'center', baseline: 'top' })

  return doc
}

export async function downloadQrSheet(brigadeName: string, url: string): Promise<void> {
  const doc = await buildQrSheetPdf(brigadeName, url)
  doc.save(qrSheetFilename(brigadeName))
}

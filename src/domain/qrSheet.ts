const TITLE_MAX_PT = 32
const TITLE_MIN_PT = 22

export interface FittedTitle {
  fontSize: number
  lines: string[]
}

// The width of `text` at `fontSize`, in the same unit as the available width.
export type MeasureText = (text: string, fontSize: number) => number

export function qrSheetTitle(brigadeName: string): string {
  return `${brigadeName} Appliance Checks`
}

export function qrSheetFilename(brigadeName: string): string {
  return `${brigadeName} QR code.pdf`
}

export function fitTitle(text: string, maxWidth: number, measure: MeasureText): FittedTitle {
  const widthAtMax = measure(text, TITLE_MAX_PT)
  if (widthAtMax <= maxWidth) return { fontSize: TITLE_MAX_PT, lines: [text] }
  if (measure(text, TITLE_MIN_PT) <= maxWidth) {
    // Width scales with font size, so this lands between the min and max.
    return { fontSize: Math.floor((TITLE_MAX_PT * maxWidth) / widthAtMax), lines: [text] }
  }

  // Split where the longer line is shortest, so neither line is left with a stray word.
  const words = text.split(' ')
  let best: string[] = [text]
  let bestWidth = Infinity
  for (let index = 1; index < words.length; index++) {
    const lines = [words.slice(0, index).join(' '), words.slice(index).join(' ')]
    const width = Math.max(...lines.map((line) => measure(line, TITLE_MIN_PT)))
    if (width < bestWidth) {
      best = lines
      bestWidth = width
    }
  }
  return { fontSize: TITLE_MIN_PT, lines: best }
}

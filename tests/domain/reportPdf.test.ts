import { describe, expect, it } from 'vitest'
import { cellFills, dateCells, footRow, footerFill } from '../../src/report/pdf'
import type { ReportColumn } from '../../src/domain/report'
import type { Check } from '../../src/domain/types'

const GREEN = [198, 239, 206]
const RED = [255, 199, 206]
const AMBER = [255, 235, 156]

function column(percent: number, started = true): ReportColumn {
  return {
    date: '2026-09-29',
    check: started ? ({ scheduledDate: '2026-09-29' } as Check) : null,
    version: 1,
    monthly: false,
    percent,
  }
}

describe('cellFills', () => {
  it('shades a Y answer green under the Y column only', () => {
    expect(cellFills({ kind: 'yn', value: 'Y' })).toEqual([GREEN, undefined])
  })

  it('shades an N answer red under the N column only', () => {
    expect(cellFills({ kind: 'yn', value: 'N' })).toEqual([undefined, RED])
  })

  it('shades an unanswered Y/N cell amber across both columns', () => {
    expect(cellFills({ kind: 'yn', value: null })).toEqual([AMBER, AMBER])
  })

  it('shades an unanswered written or choice cell amber', () => {
    expect(cellFills({ kind: 'value', value: null })).toEqual([AMBER])
  })

  it('leaves an answered written or choice cell alone', () => {
    expect(cellFills({ kind: 'value', value: '3419' })).toEqual([undefined])
  })

  it('leaves not-due and n/a cells alone', () => {
    expect(cellFills({ kind: 'notDue' })).toEqual([undefined])
    expect(cellFills({ kind: 'na' })).toEqual([undefined])
  })
})

describe('footerFill', () => {
  it('is green for a Complete Check', () => {
    expect(footerFill(column(100))).toEqual(GREEN)
  })

  it('is amber for a partly answered Check', () => {
    expect(footerFill(column(60))).toEqual(AMBER)
  })

  it('is amber for a Check that was never started', () => {
    expect(footerFill(column(0, false))).toEqual(AMBER)
  })

  it('is amber for a started Check at 0%', () => {
    expect(footerFill(column(0))).toEqual(AMBER)
  })
})

// `cellFills`/`footerFill` are only half the story: these check the colours reach the table cells.
describe('table cells', () => {
  function fillOf(cell: unknown): unknown {
    return (cell as { styles?: { fillColor?: unknown } }).styles?.fillColor
  }

  it('puts a Y answer\'s green on the Y cell and leaves the N cell unshaded', () => {
    const [y, n] = dateCells({ kind: 'yn', value: 'Y' })
    expect(fillOf(y)).toEqual(GREEN)
    expect(fillOf(n)).toBeUndefined()
  })

  it('puts an N answer\'s red on the N cell and leaves the Y cell unshaded', () => {
    const [y, n] = dateCells({ kind: 'yn', value: 'N' })
    expect(fillOf(y)).toBeUndefined()
    expect(fillOf(n)).toEqual(RED)
  })

  it('shades an unanswered written cell amber, and an answered one not at all', () => {
    expect(fillOf(dateCells({ kind: 'value', value: null })[0])).toEqual(AMBER)
    expect(fillOf(dateCells({ kind: 'value', value: '3419' })[0])).toBeUndefined()
  })

  it('colours each footer status cell from its Check', () => {
    const [, ...cells] = footRow([column(100), column(60), column(0, false)]) as unknown[]
    expect(cells.map(fillOf)).toEqual([GREEN, AMBER, AMBER])
  })
})

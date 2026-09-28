import { describe, expect, it } from 'vitest'
import { buildMonthlyReport } from '../../src/domain/report'
import type { MonthlyReport } from '../../src/domain/report'
import type { Appliance, Brigade, Check, CheckSheetVersion, Section } from '../../src/domain/types'

const TORCH = 'aaa22222'
const OLD = 'bbb22222'
const LADDER = 'ccc22222'
const REGO = 'ddd22222'
const FUEL = 'eee22222'
const NEW = 'fff22222'
const HOSE = 'ggg22222'
const OLD_SECTION_ITEM = 'hhh22222'

function brigade(overrides: Partial<Brigade> = {}): Brigade {
  return { brigadeId: 'abc123', name: 'Test Brigade', checkDay: 1, active: true, ...overrides }
}

function appliance(overrides: Partial<Appliance> = {}): Appliance {
  return { callsign: 'Test 8011', active: true, currentCheckSheetVersion: 2, ...overrides }
}

function v1(): CheckSheetVersion {
  const sectionA: Section = {
    id: 'section-a',
    title: 'Section A',
    items: [
      { id: TORCH, label: 'Torch', qty: '1', inputType: 'yn', scope: 'weekly' },
      { id: OLD, label: 'Old', qty: '1', inputType: 'yn', scope: 'weekly' },
      { id: LADDER, label: 'Ladder', qty: '1', inputType: 'yn', scope: 'monthly' },
      { id: REGO, label: 'Rego expiry', qty: null, inputType: 'written', scope: 'weekly' },
      { id: FUEL, label: 'Fuel', qty: null, inputType: 'yn', scope: 'weekly' },
    ],
  }
  const sectionOld: Section = {
    id: 'section-old',
    title: 'Section Old',
    items: [{ id: OLD_SECTION_ITEM, label: 'Old Section Item', qty: '1', inputType: 'yn', scope: 'weekly' }],
  }
  return { version: 1, createdAt: new Date(), origin: { type: 'editor' }, sections: [sectionA, sectionOld] }
}

function v2(): CheckSheetVersion {
  const sectionA: Section = {
    id: 'section-a',
    title: 'Section A',
    items: [
      { id: TORCH, label: 'Torch (LED)', qty: '1', inputType: 'yn', scope: 'weekly' },
      { id: LADDER, label: 'Ladder', qty: '1', inputType: 'yn', scope: 'monthly' },
      { id: REGO, label: 'Rego expiry', qty: null, inputType: 'written', scope: 'weekly' },
      { id: FUEL, label: 'Fuel', qty: null, inputType: 'written', scope: 'weekly' },
      { id: NEW, label: 'New Item', qty: '1', inputType: 'yn', scope: 'weekly' },
    ],
  }
  const sectionB: Section = {
    id: 'section-b',
    title: 'Section B',
    items: [{ id: HOSE, label: 'Hose', qty: '1', inputType: 'yn', scope: 'monthly' }],
  }
  return { version: 2, createdAt: new Date(), origin: { type: 'editor' }, sections: [sectionA, sectionB] }
}

function check(overrides: Partial<Check> = {}): Check {
  return {
    applianceId: '8011',
    scheduledDate: '2026-08-03',
    monthly: false,
    checkSheetVersion: 1,
    responses: {},
    ...overrides,
  }
}

function cellAt(report: MonthlyReport, sectionId: string, itemId: string, date: string) {
  const section = report.sections.find((candidate) => candidate.id === sectionId)!
  const row = section.rows.find((candidate) => candidate.item.id === itemId)!
  const columnIndex = report.columns.findIndex((column) => column.date === date)
  return row.cells[columnIndex]
}

function columnAt(report: MonthlyReport, date: string) {
  return report.columns.find((column) => column.date === date)!
}

// A Complete v1 Check on the 3rd and an incomplete v1 Check on the 17th, whose window is still
// open on today (a Wednesday), so the current-month window stops at the 17th too.
function augustReport(): MonthlyReport {
  return buildMonthlyReport({
    brigade: brigade(),
    appliance: appliance(),
    month: '2026-08',
    checks: [
      check({
        scheduledDate: '2026-08-03',
        checkSheetVersion: 1,
        responses: { [TORCH]: 'Y', [OLD]: 'N', [REGO]: '31/12/26', [FUEL]: 'Y', [OLD_SECTION_ITEM]: 'Y', [NEW]: 'Y' },
      }),
      check({
        scheduledDate: '2026-08-17',
        checkSheetVersion: 1,
        responses: { [FUEL]: 'Written answer' },
      }),
    ],
    versions: new Map([[1, v1()]]),
    currentVersion: v2(),
    today: '2026-08-19',
  })
}

// Today is well past the month, so the whole month's Check Days show, plus one Check on a
// since-abandoned Wednesday Check Day.
function fullMonthReport(): MonthlyReport {
  return buildMonthlyReport({
    brigade: brigade(),
    appliance: appliance(),
    month: '2026-08',
    checks: [check({ scheduledDate: '2026-08-05', checkSheetVersion: 2, monthly: false, responses: {} })],
    versions: new Map([[1, v1()]]),
    currentVersion: v2(),
    today: '2026-10-01',
  })
}

function noChecksReport(): MonthlyReport {
  return buildMonthlyReport({
    brigade: brigade(),
    appliance: appliance(),
    month: '2026-08',
    checks: [],
    versions: new Map([[1, v1()]]),
    currentVersion: v2(),
    today: '2026-10-01',
  })
}

describe('row merge', () => {
  it('places the v1-only Old Item right after Torch in Section A', () => {
    const ids = augustReport()
      .sections.find((section) => section.id === 'section-a')!
      .rows.map((row) => row.item.id)

    expect(ids.indexOf(OLD)).toBe(ids.indexOf(TORCH) + 1)
  })

  it("shows Torch's row label from v2, the newest version containing it", () => {
    const sectionA = augustReport().sections.find((section) => section.id === 'section-a')!

    expect(sectionA.rows.find((row) => row.item.id === TORCH)!.item.label).toBe('Torch (LED)')
  })

  it('places the v1-only Section Old after Section A and before Section B', () => {
    expect(augustReport().sections.map((section) => section.id)).toEqual(['section-a', 'section-old', 'section-b'])
  })

  it('keeps an Item moved to another Section in v2 only in its v2 Section', () => {
    const moved = v2()
    moved.sections[0].items = moved.sections[0].items.filter((item) => item.id !== TORCH)
    moved.sections[1].items.push({ id: TORCH, label: 'Torch', qty: '1', inputType: 'yn', scope: 'weekly' })
    const report = buildMonthlyReport({
      brigade: brigade(),
      appliance: appliance(),
      month: '2026-08',
      checks: [
        check({ scheduledDate: '2026-08-03', checkSheetVersion: 1, responses: { [TORCH]: 'Y' } }),
        check({ scheduledDate: '2026-08-10', checkSheetVersion: 2, responses: { [TORCH]: 'Y' } }),
      ],
      versions: new Map([[1, v1()]]),
      currentVersion: moved,
      today: '2026-10-01',
    })

    const sectionsWithTorch = report.sections.filter((section) => section.rows.some((row) => row.item.id === TORCH))
    expect(sectionsWithTorch.map((section) => section.id)).toEqual(['section-b'])
  })
})

describe('cells', () => {
  it('shows na for the v2-only New Item on a v1 column, ignoring its stray response', () => {
    expect(cellAt(augustReport(), 'section-a', NEW, '2026-08-03')).toEqual({ kind: 'na' })
  })

  it('shows na for the v1-only Old Item on a v2 column', () => {
    expect(cellAt(augustReport(), 'section-a', OLD, '2026-08-17')).toEqual({ kind: 'na' })
  })

  it('shows Y for Torch and the written value for Rego on the Complete v1 Check', () => {
    const report = augustReport()

    expect(cellAt(report, 'section-a', TORCH, '2026-08-03')).toEqual({ kind: 'yn', value: 'Y' })
    expect(cellAt(report, 'section-a', REGO, '2026-08-03')).toEqual({ kind: 'value', value: '31/12/26' })
  })

  it('shows notDue for the monthly Ladder Item on a weekly column, and yn on the monthly column', () => {
    const report = fullMonthReport()

    expect(cellAt(report, 'section-a', LADDER, '2026-08-03')).toEqual({ kind: 'notDue' })
    expect(cellAt(report, 'section-a', LADDER, '2026-08-31').kind).toBe('yn')
  })

  it('renders Fuel as Y / N on v1 and as a written value on v2, per column input type', () => {
    const report = augustReport()

    expect(cellAt(report, 'section-a', FUEL, '2026-08-03')).toEqual({ kind: 'yn', value: 'Y' })
    expect(cellAt(report, 'section-a', FUEL, '2026-08-17')).toEqual({ kind: 'value', value: 'Written answer' })
  })
})

describe('columns', () => {
  it('renders a missing column as 0% with empty cells against the base version, not na', () => {
    const report = augustReport()
    const column = columnAt(report, '2026-08-10')

    expect(column.percent).toBe(0)
    expect(cellAt(report, 'section-a', TORCH, '2026-08-10')).toEqual({ kind: 'yn', value: null })
  })

  it('renders a missing column against the base version when it is older than the current one', () => {
    const report = buildMonthlyReport({
      brigade: brigade(),
      appliance: appliance(),
      month: '2026-08',
      checks: [check({ scheduledDate: '2026-08-03', checkSheetVersion: 1, responses: { [TORCH]: 'Y' } })],
      versions: new Map([[1, v1()]]),
      currentVersion: v2(),
      today: '2026-10-01',
    })

    expect(columnAt(report, '2026-08-10').version).toBe(1)
    expect(cellAt(report, 'section-a', OLD, '2026-08-10')).toEqual({ kind: 'yn', value: null })
    expect(report.sections.flatMap((section) => section.rows).some((row) => row.item.id === NEW)).toBe(false)
  })

  it('marks the missing last-of-month column as monthly', () => {
    expect(columnAt(fullMonthReport(), '2026-08-31').monthly).toBe(true)
  })

  it('stops at the current window in the current month', () => {
    expect(augustReport().columns.map((column) => column.date)).toEqual(['2026-08-03', '2026-08-10', '2026-08-17'])
  })

  it('includes an existing Check from an old Check Day alongside the computed dates', () => {
    expect(fullMonthReport().columns.map((column) => column.date)).toEqual([
      '2026-08-03',
      '2026-08-05',
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
    ])
  })

  it('rounds percent down', () => {
    // A monthly v2 Check has 6 due Items, so 1 answered is 16.7%.
    const report = buildMonthlyReport({
      brigade: brigade(),
      appliance: appliance(),
      month: '2026-08',
      checks: [check({ scheduledDate: '2026-08-31', monthly: true, checkSheetVersion: 2, responses: { [TORCH]: 'Y' } })],
      versions: new Map(),
      currentVersion: v2(),
      today: '2026-10-01',
    })

    expect(columnAt(report, '2026-08-31').percent).toBe(16)
  })
})

describe('version choice', () => {
  it('renders the current version for an incomplete Check whose window is still open', () => {
    expect(columnAt(augustReport(), '2026-08-17').version).toBe(2)
  })

  it('renders the stamped version for a Complete Check', () => {
    expect(columnAt(augustReport(), '2026-08-03').version).toBe(1)
  })
})

describe('no Checks in the month', () => {
  it('renders every column at 0% against the current version', () => {
    const report = noChecksReport()

    expect(report.columns.every((column) => column.percent === 0 && column.version === 2)).toBe(true)
  })

  it('builds rows from the current version alone', () => {
    expect(noChecksReport().sections.map((section) => section.id)).toEqual(['section-a', 'section-b'])
  })
})

import { describe, expect, it } from 'vitest'
import { diffSheets, summary } from '../../src/domain/sheetDiff'
import type { Item, Section } from '../../src/domain/types'

function item(id: string, overrides: Partial<Item> = {}): Item {
  return { id, label: id, qty: null, inputType: 'yn', scope: 'weekly', ...overrides }
}

function section(id: string, items: Item[], title = id): Section {
  return { id, title, items }
}

function base(): Section[] {
  return [section('s1', [item('a'), item('b'), item('c')]), section('s2', [item('d')]), section('s3', [])]
}

describe('diffSheets items', () => {
  it('marks an added Item', () => {
    const draft = base()
    draft[0].items.push(item('n'))

    const diff = diffSheets(base(), draft)

    expect([...diff.items.added]).toEqual(['n'])
    expect(diff.counts).toMatchObject({ added: 1, removed: 0 })
  })

  it('lists a removed Item with its Section title', () => {
    const draft = base()
    draft[1].items = []

    const diff = diffSheets(base(), draft)

    expect(diff.items.removed).toEqual([{ item: item('d'), sectionTitle: 's2' }])
  })

  it('marks a label change as renamed only', () => {
    const draft = base()
    draft[0].items[0] = item('a', { label: 'Alpha' })

    const diff = diffSheets(base(), draft)

    expect([...diff.items.renamed]).toEqual(['a'])
    expect(diff.items.changed.size).toBe(0)
  })

  it.each<[string, Partial<Item>]>([
    ['qty', { qty: '2' }],
    ['inputType', { inputType: 'written' }],
    ['options', { inputType: 'choice', options: ['x', 'y'] }],
    ['scope', { scope: 'monthly' }],
  ])('marks a %s difference as changed', (_name, overrides) => {
    const draft = base()
    draft[0].items[0] = item('a', overrides)

    expect([...diffSheets(base(), draft).items.changed]).toEqual(['a'])
  })

  it('marks an Item renamed, changed and moved at once', () => {
    const draft = base()
    const [moving] = draft[0].items.splice(0, 1)
    draft[1].items.push({ ...moving, label: 'Alpha', qty: '3' })

    const diff = diffSheets(base(), draft)

    expect([...diff.items.renamed]).toEqual(['a'])
    expect([...diff.items.changed]).toEqual(['a'])
    expect([...diff.items.moved]).toEqual(['a'])
  })

  it('marks an Item moved to another Section', () => {
    const draft = base()
    draft[1].items.push(...draft[0].items.splice(1, 1))

    expect([...diffSheets(base(), draft).items.moved]).toEqual(['b'])
  })

  it('marks only the first Item when it moves to the end of its Section', () => {
    const draft = base()
    draft[0].items = [item('b'), item('c'), item('a')]

    expect([...diffSheets(base(), draft).items.moved]).toEqual(['a'])
  })

  it('marks nothing moved when an Item is removed from the middle', () => {
    const draft = base()
    draft[0].items = [item('a'), item('c')]

    expect(diffSheets(base(), draft).items.moved.size).toBe(0)
  })
})

describe('diffSheets sections', () => {
  it('marks an added Section and counts its Items as added', () => {
    const draft = [...base(), section('s4', [item('x'), item('y')])]

    const diff = diffSheets(base(), draft)

    expect([...diff.sections.added]).toEqual(['s4'])
    expect(diff.counts.added).toBe(3)
  })

  it('lists a removed Section and counts its Items as removed', () => {
    const draft = base().filter((candidate) => candidate.id !== 's1')

    const diff = diffSheets(base(), draft)

    expect(diff.sections.removed.map((removed) => removed.id)).toEqual(['s1'])
    expect(diff.counts.removed).toBe(4)
  })

  it('marks a title change as renamed', () => {
    const draft = base()
    draft[1].title = 'Two'

    expect([...diffSheets(base(), draft).sections.renamed]).toEqual(['s2'])
  })

  it('marks only the Section that moved', () => {
    const [first, ...rest] = base()

    const diff = diffSheets(base(), [...rest, first])

    expect([...diff.sections.moved]).toEqual(['s1'])
  })
})

describe('summary', () => {
  it('has all zero counts and an empty summary for identical sheets', () => {
    const diff = diffSheets(base(), base())

    expect(diff.counts).toEqual({ added: 0, removed: 0, renamed: 0, changed: 0, moved: 0 })
    expect(summary(diff.counts)).toBe('')
  })

  it('lists non-zero counts in a fixed order', () => {
    expect(summary({ added: 3, removed: 1, renamed: 1, changed: 0, moved: 0 })).toBe('3 added · 1 removed · 1 renamed')
  })
})

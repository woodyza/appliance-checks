import { describe, expect, it } from 'vitest'
import {
  applyOp,
  type DraftEdit,
  type DraftOp,
  editOp,
  planDiscard,
  planDraftEdit,
  planPublish,
  startDraft,
  uniqueId,
} from '../../src/domain/sheetDraft'
import type { CheckSheetDraft, CheckSheetVersion, Item, Section } from '../../src/domain/types'

function item(id: string, overrides: Partial<Item> = {}): Item {
  return { id, label: id, qty: null, inputType: 'yn', scope: 'weekly', ...overrides }
}

function sheet(): Section[] {
  return [
    { id: 's1', title: 'S1', items: [item('a'), item('b'), item('c')] },
    { id: 's2', title: 'S2', items: [item('d')] },
    { id: 's3', title: 'S3', items: [] },
  ]
}

function version(overrides: Partial<CheckSheetVersion> = {}): CheckSheetVersion {
  return { version: 1, createdAt: new Date(), origin: { type: 'import', spreadsheetId: 'x' }, sections: sheet(), ...overrides }
}

function ids(section: Section): string[] {
  return section.items.map((entry) => entry.id)
}

describe('applyOp', () => {
  it('setItem on a label keeps the id and position', () => {
    const result = applyOp(sheet(), { type: 'setItem', itemId: 'b', fields: { label: 'Bee' } })!

    expect(result[0].items[1]).toEqual(item('b', { label: 'Bee' }))
  })

  it('setItem to Y/N drops options, and to Choice starts with none', () => {
    const base = sheet()
    base[0].items[0] = item('a', { inputType: 'choice', options: ['x', 'y'] })

    const toYn = applyOp(base, { type: 'setItem', itemId: 'a', fields: { inputType: 'yn' } })!
    const toChoice = applyOp(sheet(), { type: 'setItem', itemId: 'a', fields: { inputType: 'choice' } })!

    expect(toYn[0].items[0]).not.toHaveProperty('options')
    expect(toChoice[0].items[0].options).toEqual([])
  })

  it('addItem inserts at the index, and appends when the index is past the end', () => {
    const inserted = applyOp(sheet(), { type: 'addItem', sectionId: 's1', index: 1, item: item('n') })!
    const appended = applyOp(sheet(), { type: 'addItem', sectionId: 's1', index: 99, item: item('n') })!

    expect(ids(inserted[0])).toEqual(['a', 'n', 'b', 'c'])
    expect(ids(appended[0])).toEqual(['a', 'b', 'c', 'n'])
  })

  it('addItem with an id used anywhere in the sheet is refused', () => {
    expect(applyOp(sheet(), { type: 'addItem', sectionId: 's1', index: 0, item: item('d') })).toBeNull()
  })

  it('removeItem removes it', () => {
    const result = applyOp(sheet(), { type: 'removeItem', itemId: 'b' })!

    expect(ids(result[0])).toEqual(['a', 'c'])
  })

  it('moveItem within a Section keeps the id and fields', () => {
    const result = applyOp(sheet(), { type: 'moveItem', itemId: 'a', toSectionId: 's1', index: 2 })!

    expect(ids(result[0])).toEqual(['b', 'c', 'a'])
  })

  it('moveItem across Sections keeps the id and fields', () => {
    const base = sheet()
    base[0].items[0] = item('a', { label: 'Alpha', qty: '2' })

    const result = applyOp(base, { type: 'moveItem', itemId: 'a', toSectionId: 's2', index: 0 })!

    expect(ids(result[0])).toEqual(['b', 'c'])
    expect(result[1].items[0]).toEqual(item('a', { label: 'Alpha', qty: '2' }))
  })

  it('addSection appends, renameSection renames, removeSection drops its Items, moveSection reorders', () => {
    const added = applyOp(sheet(), { type: 'addSection', index: 3, section: { id: 's4', title: 'S4', items: [] } })!
    const renamed = applyOp(sheet(), { type: 'renameSection', sectionId: 's2', title: 'Two' })!
    const removed = applyOp(sheet(), { type: 'removeSection', sectionId: 's1' })!
    const moved = applyOp(sheet(), { type: 'moveSection', sectionId: 's3', index: 0 })!

    expect(added.map((section) => section.id)).toEqual(['s1', 's2', 's3', 's4'])
    expect(renamed[1].title).toBe('Two')
    expect(removed.map((section) => section.id)).toEqual(['s2', 's3'])
    expect(moved.map((section) => section.id)).toEqual(['s3', 's1', 's2'])
  })

  it.each<[string, DraftOp]>([
    ['setItem', { type: 'setItem', itemId: 'zz', fields: { label: 'x' } }],
    ['removeItem', { type: 'removeItem', itemId: 'zz' }],
    ['moveItem of a missing Item', { type: 'moveItem', itemId: 'zz', toSectionId: 's1', index: 0 }],
    ['moveItem to a missing Section', { type: 'moveItem', itemId: 'a', toSectionId: 'zz', index: 0 }],
    ['renameSection', { type: 'renameSection', sectionId: 'zz', title: 'x' }],
    ['removeSection', { type: 'removeSection', sectionId: 'zz' }],
    ['moveSection', { type: 'moveSection', sectionId: 'zz', index: 0 }],
  ])('refuses %s on a missing id', (_name, op) => {
    expect(applyOp(sheet(), op)).toBeNull()
  })

  it('leaves the input unchanged', () => {
    const input = sheet()

    applyOp(input, { type: 'moveItem', itemId: 'a', toSectionId: 's2', index: 0 })
    applyOp(input, { type: 'setItem', itemId: 'b', fields: { label: 'x' } })
    applyOp(input, { type: 'removeSection', sectionId: 's1' })

    expect(input).toEqual(sheet())
  })
})

describe('uniqueId', () => {
  it('re-draws when the first id is taken', () => {
    const draws = ['taken', 'fresh']

    expect(uniqueId(new Set(['taken']), () => draws.shift()!)).toBe('fresh')
  })
})

describe('startDraft', () => {
  it('copies base, origin and sections from a version', () => {
    const current = version({ version: 3 })

    expect(startDraft(current)).toEqual({ baseVersion: 3, origin: current.origin, sections: current.sections })
  })

  it('starts empty with an editor origin when there is no version', () => {
    expect(startDraft(null)).toEqual({ baseVersion: null, origin: { type: 'editor' }, sections: [] })
  })
})

describe('planDraftEdit', () => {
  const rename = editOp({ type: 'setItem', itemId: 'a', fields: { label: 'Alpha' } })

  function draft(overrides: Partial<CheckSheetDraft> = {}): CheckSheetDraft {
    return { baseVersion: 1, origin: { type: 'editor' }, sections: sheet(), ...overrides }
  }

  it('is stale when the loaded draft no longer exists', () => {
    expect(planDraftEdit({ draftExists: true, baseVersion: 1 }, null, 1, version(), rename)).toEqual({ kind: 'stale' })
  })

  it("is stale when the draft's base differs from the loaded one", () => {
    const result = planDraftEdit({ draftExists: true, baseVersion: 1 }, draft({ baseVersion: 2 }), 2, version(), rename)

    expect(result).toEqual({ kind: 'stale' })
  })

  it('is stale when there is no draft and the pointer moved', () => {
    const result = planDraftEdit({ draftExists: false, baseVersion: 1 }, null, 2, version(), rename)

    expect(result).toEqual({ kind: 'stale' })
  })

  it('writes a draft from the base with the op applied, origin editor', () => {
    const result = planDraftEdit({ draftExists: false, baseVersion: 1 }, null, 1, version(), rename)

    expect(result).toEqual({
      kind: 'write',
      draft: { baseVersion: 1, origin: { type: 'editor' }, sections: applyOp(sheet(), { type: 'setItem', itemId: 'a', fields: { label: 'Alpha' } }) },
    })
  })

  it('applies the op on top of an existing draft rather than the base', () => {
    const drafted = applyOp(sheet(), { type: 'removeItem', itemId: 'a' })!
    const other = sheet()[0].items.find((entry) => entry.id !== 'a')!
    const relabel = editOp({ type: 'setItem', itemId: other.id, fields: { label: 'Renamed' } })

    const result = planDraftEdit({ draftExists: true, baseVersion: 1 }, draft({ sections: drafted }), 1, version(), relabel)

    expect(result).toEqual({
      kind: 'write',
      draft: { baseVersion: 1, origin: { type: 'editor' }, sections: applyOp(drafted, { type: 'setItem', itemId: other.id, fields: { label: 'Renamed' } }) },
    })
  })

  it('writes with baseVersion null when the appliance has no Check Sheet', () => {
    const add = editOp({ type: 'addSection', index: 0, section: { id: 's1', title: 'New', items: [] } })

    const result = planDraftEdit({ draftExists: false, baseVersion: null }, null, null, null, add)

    expect(result).toEqual({
      kind: 'write',
      draft: { baseVersion: null, origin: { type: 'editor' }, sections: [{ id: 's1', title: 'New', items: [] }] },
    })
  })

  it('refuses an edit whose op returns null', () => {
    const bad = editOp({ type: 'removeItem', itemId: 'zz' })

    expect(planDraftEdit({ draftExists: false, baseVersion: 1 }, null, 1, version(), bad)).toEqual({ kind: 'refused' })
  })

  it('deletes the draft when an edit undoes the only difference from the base', () => {
    const changed = applyOp(sheet(), { type: 'setItem', itemId: 'a', fields: { label: 'Alpha' } })!
    const undo = editOp({ type: 'setItem', itemId: 'a', fields: { label: 'a' } })

    const result = planDraftEdit({ draftExists: true, baseVersion: 1 }, draft({ sections: changed }), 1, version(), undo)

    expect(result).toEqual({ kind: 'delete' })
  })

  it('sets the origin to editor on a manual edit of an imported draft', () => {
    const imported = draft({ origin: { type: 'import', spreadsheetId: 'x' } })

    const result = planDraftEdit({ draftExists: true, baseVersion: 1 }, imported, 1, version(), rename)

    expect(result).toMatchObject({ kind: 'write', draft: { origin: { type: 'editor' } } })
  })

  it("uses the edit's origin", () => {
    const importEdit: DraftEdit = { origin: { type: 'import', spreadsheetId: 'q' }, apply: (sections) => sections.slice(1) }

    const result = planDraftEdit({ draftExists: false, baseVersion: 1 }, null, 1, version(), importEdit)

    expect(result).toMatchObject({ kind: 'write', draft: { origin: { type: 'import', spreadsheetId: 'q' } } })
  })
})

describe('planPublish', () => {
  function draft(overrides: Partial<CheckSheetDraft> = {}): CheckSheetDraft {
    return { baseVersion: 1, origin: { type: 'editor' }, sections: sheet(), ...overrides }
  }

  it('is stale without a draft', () => {
    expect(planPublish({ draftExists: true, baseVersion: 1 }, null, 1)).toEqual({ kind: 'stale' })
  })

  it('is stale when the draft base differs from the loaded base', () => {
    expect(planPublish({ draftExists: true, baseVersion: 2 }, draft(), 2)).toEqual({ kind: 'stale' })
  })

  it("is replaced when the pointer isn't the draft's base", () => {
    expect(planPublish({ draftExists: true, baseVersion: 1 }, draft(), 2)).toEqual({ kind: 'replaced' })
  })

  it('is invalid with the problems when validation fails', () => {
    const blank = draft({ sections: [{ id: 's', title: 'S', items: [item('a', { label: ' ' })] }] })

    const result = planPublish({ draftExists: true, baseVersion: 1 }, blank, 1)

    expect(result).toMatchObject({ kind: 'invalid', problems: { messages: ['1 Item needs a label'] } })
  })

  it('publishes base + 1, or 1 from no base', () => {
    expect(planPublish({ draftExists: true, baseVersion: 3 }, draft({ baseVersion: 3 }), 3)).toEqual({ kind: 'publish', version: 4 })
    expect(planPublish({ draftExists: true, baseVersion: null }, draft({ baseVersion: null }), null)).toEqual({
      kind: 'publish',
      version: 1,
    })
  })
})

describe('planDiscard', () => {
  function draft(overrides: Partial<CheckSheetDraft> = {}): CheckSheetDraft {
    return { baseVersion: 1, origin: { type: 'editor' }, sections: sheet(), ...overrides }
  }

  it('discards the draft the screen loaded', () => {
    expect(planDiscard({ draftExists: true, baseVersion: 1 }, draft())).toEqual({ kind: 'discard' })
  })

  it('is stale when the loaded draft no longer exists', () => {
    expect(planDiscard({ draftExists: true, baseVersion: 1 }, null)).toEqual({ kind: 'stale' })
  })

  it("is stale when the draft's base differs from the loaded one", () => {
    expect(planDiscard({ draftExists: true, baseVersion: 1 }, draft({ baseVersion: 2 }))).toEqual({ kind: 'stale' })
  })

  it('is stale when a draft appeared that the screen did not load', () => {
    expect(planDiscard({ draftExists: false, baseVersion: 1 }, draft())).toEqual({ kind: 'stale' })
  })

  it('discards nothing when there was no draft and still is none', () => {
    expect(planDiscard({ draftExists: false, baseVersion: 1 }, null)).toEqual({ kind: 'discard' })
  })
})

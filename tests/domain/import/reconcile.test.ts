import { describe, expect, it } from 'vitest'
import { reconcile } from '../../../src/domain/import/reconcile'
import type { ParsedCheckSheet, Section } from '../../../src/domain/types'

function makeCounterId(): () => string {
  let n = 0
  return () => `id${++n}`
}

function cab(items: Section['items']): Section {
  return { id: 'cab-id', title: 'Cab', items }
}

function torch(overrides: Partial<Section['items'][number]> = {}): Section['items'][number] {
  return { id: 'torch-id', label: 'Torch', qty: '1', inputType: 'yn', scope: 'weekly', ...overrides }
}

function parsedTorch(overrides: Partial<ParsedCheckSheet['sections'][number]['items'][number]> = {}) {
  return { label: 'Torch', qty: '1', inputType: 'yn' as const, scope: 'weekly' as const, ...overrides }
}

describe('reconcile', () => {
  it('assigns every Section and Item a new id when there is no current Check Sheet', () => {
    const parsed: ParsedCheckSheet = { sections: [{ title: 'Cab', items: [parsedTorch()] }] }

    const result = reconcile(null, parsed, makeCounterId())

    expect(result.sections[0].id).toBe('id1')
    expect(result.sections[0].items[0].id).toBe('id2')
    expect(result.report.sectionsAdded).toEqual(['Cab'])
    expect(result.report.added).toEqual([{ section: 'Cab', label: 'Torch' }])
    expect(result.report.matched).toEqual([])
    expect(result.report.changed).toEqual([])
    expect(result.report.removed).toEqual([])
    expect(result.unchanged).toBe(false)
  })

  it('keeps ids and reports everything matched when the same content is re-parsed', () => {
    const current: Section[] = [cab([torch()])]
    const parsed: ParsedCheckSheet = { sections: [{ title: 'Cab', items: [parsedTorch()] }] }

    const result = reconcile(current, parsed, makeCounterId())

    expect(result.sections).toEqual(current)
    expect(result.report.matched).toEqual([{ section: 'Cab', label: 'Torch' }])
    expect(result.report.changed).toEqual([])
    expect(result.unchanged).toBe(true)
  })

  it('keeps the id and reports a label field change when the label differs only in case/whitespace', () => {
    const current: Section[] = [cab([torch({ label: 'Torch' })])]
    const parsed: ParsedCheckSheet = { sections: [{ title: 'Cab', items: [parsedTorch({ label: ' torch ' })] }] }

    const result = reconcile(current, parsed, makeCounterId())

    expect(result.sections[0].items[0].id).toBe('torch-id')
    expect(result.sections[0].items[0].label).toBe(' torch ')
    expect(result.report.changed).toEqual([{ section: 'Cab', label: ' torch ', fields: ['label'] }])
  })

  it('removes the old Item and adds a new one with a new id when an Item is renamed', () => {
    const current: Section[] = [cab([torch({ label: 'Torch' })])]
    const parsed: ParsedCheckSheet = { sections: [{ title: 'Cab', items: [parsedTorch({ label: 'Hand torch' })] }] }

    const result = reconcile(current, parsed, makeCounterId())

    expect(result.report.removed).toEqual([{ section: 'Cab', label: 'Torch' }])
    expect(result.report.added).toEqual([{ section: 'Cab', label: 'Hand torch' }])
    expect(result.sections[0].items[0].id).not.toBe('torch-id')
  })

  it('keeps the id and lists exactly the fields that changed', () => {
    const current: Section[] = [cab([torch({ qty: '1', inputType: 'yn', scope: 'weekly' })])]
    const parsed: ParsedCheckSheet = {
      sections: [{ title: 'Cab', items: [parsedTorch({ qty: '2', inputType: 'choice', options: ['A', 'B'], scope: 'monthly' })] }],
    }

    const result = reconcile(current, parsed, makeCounterId())

    expect(result.sections[0].items[0].id).toBe('torch-id')
    expect(result.report.changed).toEqual([
      { section: 'Cab', label: 'Torch', fields: ['qty', 'inputType', 'options', 'scope'] },
    ])
  })

  it('removes and re-adds an Item moved to another Section, with a new id', () => {
    const current: Section[] = [cab([torch()]), { id: 'docs-id', title: 'Documents', items: [] }]
    const parsed: ParsedCheckSheet = {
      sections: [
        { title: 'Cab', items: [] },
        { title: 'Documents', items: [parsedTorch()] },
      ],
    }

    const result = reconcile(current, parsed, makeCounterId())

    expect(result.report.removed).toEqual([{ section: 'Cab', label: 'Torch' }])
    expect(result.report.added).toEqual([{ section: 'Documents', label: 'Torch' }])
    expect(result.sections[1].items[0].id).not.toBe('torch-id')
  })

  it('reports removed and added Sections, putting the removed Section items in removed', () => {
    const current: Section[] = [cab([torch()]), { id: 'old-id', title: 'Old Section', items: [torch({ id: 'old-item-id', label: 'Old item' })] }]
    const parsed: ParsedCheckSheet = {
      sections: [
        { title: 'Cab', items: [parsedTorch()] },
        { title: 'New Section', items: [parsedTorch({ label: 'New item' })] },
      ],
    }

    const result = reconcile(current, parsed, makeCounterId())

    expect(result.report.sectionsRemoved).toEqual(['Old Section'])
    expect(result.report.sectionsAdded).toEqual(['New Section'])
    expect(result.report.removed).toEqual([{ section: 'Old Section', label: 'Old item' }])
    expect(result.report.added).toEqual([{ section: 'New Section', label: 'New item' }])
  })

  it('reports unchanged: false, reordered: true, and keeps ids when Items are reordered with no other change', () => {
    const current: Section[] = [cab([torch({ id: 'torch-id', label: 'Torch' }), torch({ id: 'bucket-id', label: 'Bucket' })])]
    const parsed: ParsedCheckSheet = {
      sections: [{ title: 'Cab', items: [parsedTorch({ label: 'Bucket' }), parsedTorch({ label: 'Torch' })] }],
    }

    const result = reconcile(current, parsed, makeCounterId())

    expect(result.sections[0].items.map((item) => item.id)).toEqual(['bucket-id', 'torch-id'])
    expect(result.unchanged).toBe(false)
    expect(result.report.reordered).toBe(true)
  })

  it('keeps the id and reports a rename when the Section title differs only in case/whitespace', () => {
    const current: Section[] = [cab([torch()])]
    const parsed: ParsedCheckSheet = { sections: [{ title: ' cab ', items: [parsedTorch()] }] }

    const result = reconcile(current, parsed, makeCounterId())

    expect(result.sections[0].id).toBe('cab-id')
    expect(result.sections[0].title).toBe(' cab ')
    expect(result.report.sectionsRenamed).toEqual([{ from: 'Cab', to: ' cab ' }])
  })
})

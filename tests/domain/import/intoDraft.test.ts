import { describe, expect, it } from 'vitest'
import { copyEdit, importEdit, reconcileInto, toParsed } from '../../../src/domain/import/intoDraft'
import type { Item, ParsedCheckSheet, Section } from '../../../src/domain/types'

function item(id: string, label: string): Item {
  return { id, label, qty: null, inputType: 'yn', scope: 'weekly' }
}

function target(): Section[] {
  return [{ id: 'sec1', title: 'Cab', items: [item('torch1', 'Torch'), item('radio1', 'Radio')] }]
}

function parsedOf(...labels: string[]): ParsedCheckSheet {
  return {
    sections: [{ title: 'Cab', items: labels.map((label) => ({ label, qty: null, inputType: 'yn', scope: 'weekly' })) }],
  }
}

function counter(prefix: string): () => string {
  let n = 0
  return () => `${prefix}${++n}`
}

describe('toParsed', () => {
  it('drops ids', () => {
    expect(toParsed(target())).toEqual(parsedOf('Torch', 'Radio'))
  })
})

describe('reconcileInto', () => {
  it("keeps the target's ids for matching Section titles and Item labels", () => {
    const result = reconcileInto(target(), parsedOf('Radio', 'Torch'), counter('n'))

    expect(result[0].id).toBe('sec1')
    expect(result[0].items.map((entry) => entry.id)).toEqual(['radio1', 'torch1'])
  })

  it('gives two same-label Items distinct ids, the first keeping the target id', () => {
    const result = reconcileInto(target(), parsedOf('Torch', 'Torch'), counter('n'))

    expect(result[0].items.map((entry) => entry.id)).toEqual(['torch1', 'n1'])
  })

  it('never issues an id that is already in the target', () => {
    const draws = ['torch1', 'sec1', 'fresh']

    const result = reconcileInto(target(), parsedOf('Hose'), () => draws.shift() ?? 'unused')

    expect(result[0].items[0].id).toBe('fresh')
  })
})

describe('copyEdit and importEdit', () => {
  it('copyEdit has an editor origin and reconciles the source into the sections', () => {
    const source: Section[] = [{ id: 'src1', title: 'Cab', items: [item('srcTorch', 'Torch'), item('srcHose', 'Hose')] }]

    const edit = copyEdit(source)
    const result = edit.apply(target())!

    expect(edit.origin).toEqual({ type: 'editor' })
    expect(result[0].id).toBe('sec1')
    expect(result[0].items.map((entry) => entry.label)).toEqual(['Torch', 'Hose'])
    expect(result[0].items[0].id).toBe('torch1')
  })

  it('importEdit has an import origin and reconciles the parsed sheet into the sections', () => {
    const edit = importEdit(parsedOf('Radio'), 'sheet1')

    expect(edit.origin).toEqual({ type: 'import', spreadsheetId: 'sheet1' })
    expect(edit.apply(target())).toEqual([{ id: 'sec1', title: 'Cab', items: [item('radio1', 'Radio')] }])
  })
})

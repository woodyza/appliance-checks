import { describe, expect, it } from 'vitest'
import { validateForPublish } from '../../src/domain/publishValidation'
import type { Item, Section } from '../../src/domain/types'

function item(id: string, overrides: Partial<Item> = {}): Item {
  return { id, label: id, qty: null, inputType: 'yn', scope: 'weekly', ...overrides }
}

function sheetOf(...items: Item[]): Section[] {
  return [{ id: 's1', title: 'S1', items }]
}

function choice(options: string[]): Item {
  return item('c', { inputType: 'choice', options })
}

describe('validateForPublish', () => {
  it('has no messages for a valid sheet, and allows an empty Section', () => {
    const sheet = [...sheetOf(item('a'), choice(['x', 'y'])), { id: 's2', title: 'Empty', items: [] }]

    expect(validateForPublish(sheet).messages).toEqual([])
  })

  it.each<[string, Section[], string, 'itemIds' | 'sectionIds', string]>([
    ['a blank label', sheetOf(item('a', { label: '' })), '1 Item needs a label', 'itemIds', 'a'],
    [
      'a whitespace-only title',
      [{ id: 's1', title: '  ', items: [] }],
      '1 Section needs a title',
      'sectionIds',
      's1',
    ],
    [
      'a Choice with one option',
      sheetOf(choice(['x'])),
      '1 Choice Item needs at least two options, none blank, repeated or over 200 characters',
      'itemIds',
      'c',
    ],
    [
      'a blank option',
      sheetOf(choice(['x', ' '])),
      '1 Choice Item needs at least two options, none blank, repeated or over 200 characters',
      'itemIds',
      'c',
    ],
    [
      'a repeated option',
      sheetOf(choice(['x', 'x '])),
      '1 Choice Item needs at least two options, none blank, repeated or over 200 characters',
      'itemIds',
      'c',
    ],
    [
      'a 201-character option',
      sheetOf(choice(['x', 'y'.repeat(201)])),
      '1 Choice Item needs at least two options, none blank, repeated or over 200 characters',
      'itemIds',
      'c',
    ],
  ])('blocks %s', (_name, sheet, message, key, id) => {
    const problems = validateForPublish(sheet)

    expect(problems.messages).toEqual([message])
    expect(problems[key].has(id)).toBe(true)
  })

  it('pluralises two blank labels', () => {
    expect(validateForPublish(sheetOf(item('a', { label: '' }), item('b', { label: ' ' }))).messages).toEqual([
      '2 Items need a label',
    ])
  })

  it('blocks 501 Items but not 500', () => {
    const many = (count: number): Section[] => sheetOf(...Array.from({ length: count }, (_, i) => item(`i${i}`)))

    expect(validateForPublish(many(501)).messages).toEqual(['501 Items: a Check Sheet can have at most 500'])
    expect(validateForPublish(many(500)).messages).toEqual([])
  })
})

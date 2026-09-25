import { describe, expect, it } from 'vitest'
import { parseCheckSheet } from '../../../src/domain/import/parse'
import { grid, headerRow, listCell, marchFixture, plainCell, row, ynCell, ynCellWithColor } from '../fixtures/sheet'

describe('parseCheckSheet', () => {
  it('parses the March fixture into two Sections with Items in order, ignoring header rows', () => {
    const result = parseCheckSheet(marchFixture())

    expect(result.sections).toHaveLength(2)
    expect(result.sections[0]).toMatchObject({
      title: 'Cab',
      items: [
        { label: 'Torch', qty: '1', inputType: 'yn', scope: 'weekly' },
        { label: 'Fire extinguisher', qty: '1', inputType: 'yn', scope: 'monthly' },
        {
          label: 'FUEL',
          qty: 'FUEL',
          inputType: 'choice',
          options: ['1/4', '1/2', '3/4', 'FULL'],
          scope: 'weekly',
        },
      ],
    })
    expect(result.sections[1]).toMatchObject({
      title: 'Documents',
      items: [{ label: 'Rego expiry', qty: null, inputType: 'written', scope: 'weekly' }],
    })
  })

  it('detects checkbox validation on the Y cell as inputType yn', () => {
    const result = parseCheckSheet(grid([headerRow('Cab'), row('Torch', '1', ynCell())]))

    expect(result.sections[0].items[0].inputType).toBe('yn')
  })

  it('detects list validation as inputType choice with options in order', () => {
    const result = parseCheckSheet(
      grid([headerRow('Cab'), row('FUEL', 'FUEL', listCell(['1/4', '1/2', '3/4', 'FULL']))]),
    )

    expect(result.sections[0].items[0]).toMatchObject({
      inputType: 'choice',
      options: ['1/4', '1/2', '3/4', 'FULL'],
    })
  })

  it('treats no validation as inputType written with no options', () => {
    const result = parseCheckSheet(grid([headerRow('Documents'), row('Rego expiry', '', plainCell())]))

    expect(result.sections[0].items[0].inputType).toBe('written')
    expect(result.sections[0].items[0].options).toBeUndefined()
  })

  it('marks a yn Item with the #434343 background as monthly, and the same background on a choice Item as weekly', () => {
    const result = parseCheckSheet(
      grid([
        headerRow('Cab'),
        row('Fire extinguisher', '1', ynCell({ monthly: true })),
        row('FUEL', 'FUEL', {
          ...listCell(['1/4', '1/2', '3/4', 'FULL']),
          effectiveFormat: { backgroundColorStyle: { rgbColor: { red: 0.2627, green: 0.2627, blue: 0.2627 } } },
        }),
      ]),
    )

    expect(result.sections[0].items[0].scope).toBe('monthly')
    expect(result.sections[0].items[1].scope).toBe('weekly')
  })

  it('detects monthly background given only via the deprecated backgroundColor field', () => {
    const result = parseCheckSheet(
      grid([headerRow('Cab'), row('Fire extinguisher', '1', ynCell({ monthly: true, deprecatedColorField: true }))]),
    )

    expect(result.sections[0].items[0].scope).toBe('monthly')
  })

  it('treats a background colour with omitted zero components as black, so weekly, without crashing', () => {
    const result = parseCheckSheet(
      grid([headerRow('Cab'), row('Torch', '1', ynCellWithColor({ backgroundColorStyle: { rgbColor: {} } }))]),
    )

    expect(result.sections[0].items[0].scope).toBe('weekly')
  })

  it('stops at the MISSING - DEFECTS - ISSUES row, excluding it and everything after', () => {
    const result = parseCheckSheet(
      grid([
        headerRow('Cab'),
        row('Torch', '1', ynCell()),
        row('MISSING - DEFECTS - ISSUES Write Below', ''),
        row('Reported by driver', ''),
      ]),
    )

    expect(result.sections[0].items).toHaveLength(1)
    expect(result.sections[0].items[0].label).toBe('Torch')
  })

  it('trims qty, and turns an empty qty into null', () => {
    const result = parseCheckSheet(
      grid([headerRow('Cab'), row('Torch', ' 1each ', ynCell()), row('Rego expiry', '', plainCell())]),
    )

    expect(result.sections[0].items[0].qty).toBe('1each')
    expect(result.sections[0].items[1].qty).toBeNull()
  })

  it('detects a Y/N header pair even with a typo like "N)"', () => {
    const result = parseCheckSheet(grid([headerRow('Cab', 0, 'Y', 'N)'), row('Torch', '1', ynCell())]))

    expect(result.sections[0].items[0].inputType).toBe('yn')
  })

  it('reads validation from the Y/N pair column when it is not in C/D', () => {
    const result = parseCheckSheet(grid([headerRow('Cab', 2), row('Torch', '1', plainCell(), plainCell(), ynCell())]))

    expect(result.sections[0].items[0].inputType).toBe('yn')
  })

  it('throws ImportError when there is no "Quantity" row', () => {
    expect(() => parseCheckSheet(grid([row('Torch', '1', ynCell())]))).toThrow(/no section header/i)
  })

  it('throws a clean ImportError, not a TypeError, when the first tab has no grid data', () => {
    expect(() => parseCheckSheet({ sheets: [{}] })).toThrow(/no section header/i)
  })

  it('throws ImportError when the "Quantity" row has no Y/N pair', () => {
    expect(() => parseCheckSheet(grid([row('Cab', 'Quantity'), row('Torch', '1', ynCell())]))).toThrow(
      /Y\/N column pair/i,
    )
  })

  it('throws ImportError naming a duplicate Section title differing only in case/whitespace', () => {
    expect(() =>
      parseCheckSheet(
        grid([headerRow('Cab'), row('Torch', '1', ynCell()), row(' cab ', 'Quantity'), row('Torch', '1', ynCell())]),
      ),
    ).toThrow(/duplicate section.*cab/i)
  })

  it('throws ImportError naming Section and label for a duplicate Item label within a Section, but allows it across Sections', () => {
    expect(() =>
      parseCheckSheet(
        grid([headerRow('Cab'), row('Torch', '1', ynCell()), row(' torch ', '1', ynCell())]),
      ),
    ).toThrow(/duplicate item.*torch.*cab/i)

    expect(() =>
      parseCheckSheet(
        grid([
          headerRow('Cab'),
          row('Torch', '1', ynCell()),
          row('Documents', 'Quantity'),
          row('Torch', '1', ynCell()),
        ]),
      ),
    ).not.toThrow()
  })

  it('throws ImportError naming the row number for a "Quantity" row with an empty label', () => {
    expect(() =>
      parseCheckSheet(grid([headerRow('Cab'), row('Torch', '1', ynCell()), row('', 'Quantity')])),
    ).toThrow(/row 3/i)
  })

  it('skips rows with an empty label', () => {
    const result = parseCheckSheet(
      grid([headerRow('Cab'), row('', '', ynCell()), row('Torch', '1', ynCell())]),
    )

    expect(result.sections[0].items).toHaveLength(1)
    expect(result.sections[0].items[0].label).toBe('Torch')
  })
})

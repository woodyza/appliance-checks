import { describe, expect, it } from 'vitest'
import { fitTitle } from '../../src/domain/qrSheet'

function measure(text: string, fontSize: number): number {
  return text.length * fontSize
}

describe('fitTitle', () => {
  it('keeps a short title on one line at the largest size', () => {
    const title = 'Local Brigade Appliance Checks'

    expect(fitTitle(title, 30 * 32, measure)).toEqual({ fontSize: 32, lines: [title] })
  })

  it('shrinks a title that fits on one line above the smallest size', () => {
    const title = 'Local Brigade Appliance Checks'

    expect(fitTitle(title, 30 * 24, measure)).toEqual({ fontSize: 24, lines: [title] })
  })

  it('wraps a title too long for one line onto two balanced lines at the smallest size', () => {
    const title = 'Local Brigade Appliance Checks'

    expect(fitTitle(title, 22 * 24, measure)).toEqual({
      fontSize: 22,
      lines: ['Local Brigade', 'Appliance Checks'],
    })
  })
})

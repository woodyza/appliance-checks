import { describe, expect, it } from 'vitest'
import { SLUG_ALPHABET, SLUG_PATTERN, generateSlug } from '../../src/domain/slug'

describe('generateSlug', () => {
  it('returns a 6 character slug using only the slug alphabet', () => {
    const slug = generateSlug()

    expect(slug).toHaveLength(6)
    for (const char of slug) {
      expect(SLUG_ALPHABET).toContain(char)
    }
    expect(slug).toMatch(new RegExp(`^${SLUG_PATTERN}$`))
  })
})

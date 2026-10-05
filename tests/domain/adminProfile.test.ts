import { describe, expect, it } from 'vitest'
import { type AdminProfile, adminHomePath, batches, canManage, hasHub } from '../../src/domain/adminProfile'

const superadmin: AdminProfile = { kind: 'superadmin' }
const vso: AdminProfile = { kind: 'admin', role: 'vso', brigadeIds: ['b1', 'b2'], homeSlug: 'abc123' }
const none: AdminProfile = { kind: 'none' }

function brigadeAdmin(homeSlug: string | null): AdminProfile {
  return { kind: 'admin', role: 'brigadeAdmin', brigadeIds: ['b1'], homeSlug }
}

describe('adminHomePath', () => {
  it.each([
    ['a superadmin', superadmin],
    ['a VSO', vso],
    ['a Brigade Admin with no home brigade', brigadeAdmin(null)],
    ['no admin profile', none],
  ])('is the hub for %s', (_label, profile) => {
    expect(adminHomePath(profile)).toBe('/admin')
  })

  it("is the brigade's admin page for a Brigade Admin with a home brigade", () => {
    expect(adminHomePath(brigadeAdmin('abc123'))).toBe('/abc123/admin')
  })
})

describe('hasHub', () => {
  it.each([
    ['a superadmin', superadmin, true],
    ['a VSO', vso, true],
    ['a Brigade Admin', brigadeAdmin('abc123'), false],
    ['no admin profile', none, false],
  ])('for %s is %s', (_label, profile, expected) => {
    expect(hasHub(profile)).toBe(expected)
  })
})

describe('canManage', () => {
  it('lets a superadmin manage any brigade', () => {
    expect(canManage(superadmin, 'anything')).toBe(true)
  })

  it('lets an admin manage a brigade they are assigned to', () => {
    expect(canManage(brigadeAdmin('abc123'), 'b1')).toBe(true)
  })

  it('stops an admin managing a brigade they are not assigned to', () => {
    expect(canManage(brigadeAdmin('abc123'), 'b2')).toBe(false)
  })

  it('stops someone with no admin profile', () => {
    expect(canManage(none, 'b1')).toBe(false)
  })
})

describe('batches', () => {
  it('splits items into batches of at most the given size', () => {
    const items = Array.from({ length: 31 }, (_, index) => index)

    expect(batches(items, 30).map((batch) => batch.length)).toEqual([30, 1])
  })

  it('returns no batches for no items', () => {
    expect(batches([], 30)).toEqual([])
  })
})

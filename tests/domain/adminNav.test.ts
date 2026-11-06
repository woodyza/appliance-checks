import { describe, expect, it } from 'vitest'
import type { AdminProfile } from '../../src/domain/adminProfile'
import { adminNav } from '../../src/domain/adminNav'

const superadmin: AdminProfile = { kind: 'superadmin' }
const vso: AdminProfile = { kind: 'admin', role: 'vso', brigadeIds: ['b1', 'b2'], homeSlug: null }
const brigadeAdmin: AdminProfile = { kind: 'admin', role: 'brigadeAdmin', brigadeIds: ['b1'], homeSlug: 'abc123' }
const none: AdminProfile = { kind: 'none' }

const brigade = { slug: 'abc123', name: 'Mangawhai' }

describe('adminNav top-level links', () => {
  it('gives a superadmin Users and Brigades', () => {
    expect(adminNav(superadmin, undefined, null).top).toEqual([
      { label: 'Users', to: '/admin/users', icon: 'users' },
      { label: 'Brigades', to: '/admin/brigades', icon: 'brigades' },
    ])
  })

  it('gives a VSO Brigades only', () => {
    expect(adminNav(vso, undefined, null).top).toEqual([{ label: 'Brigades', to: '/admin/brigades', icon: 'brigades' }])
  })

  it.each([
    ['a Brigade Admin', brigadeAdmin],
    ['no admin profile', none],
    ['a profile that has not loaded', null],
  ])('gives %s none', (_label, profile) => {
    expect(adminNav(profile, undefined, null).top).toEqual([])
  })
})

describe('adminNav brigade group', () => {
  it('appears with the brigade name and Overview when a brigade is passed', () => {
    expect(adminNav(brigadeAdmin, brigade, []).brigade).toEqual({
      name: 'Mangawhai',
      overview: '/abc123/admin',
      appliances: [],
    })
  })

  it('is absent when no brigade is passed', () => {
    expect(adminNav(superadmin, undefined, []).brigade).toBeNull()
  })

  it('lists appliances sorted by callsign and flags the inactive ones', () => {
    const appliances = [
      { id: 'b', callsign: 'B', active: true },
      { id: 'a', callsign: 'A', active: false },
    ]

    expect(adminNav(superadmin, brigade, appliances).brigade?.appliances).toEqual([
      { label: 'A', to: '/abc123/admin/a', inactive: true },
      { label: 'B', to: '/abc123/admin/b', inactive: false },
    ])
  })

  it('has no appliances when they have not loaded', () => {
    expect(adminNav(superadmin, brigade, null).brigade).toEqual({
      name: 'Mangawhai',
      overview: '/abc123/admin',
      appliances: [],
    })
  })
})

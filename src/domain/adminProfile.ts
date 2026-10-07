import type { AdminRole } from './types'

export type AdminProfile =
  | { kind: 'superadmin' }
  | { kind: 'admin'; role: AdminRole; brigadeIds: string[]; homeSlug: string | null }
  | { kind: 'none' }

export function adminHomePath(profile: AdminProfile): string {
  if (profile.kind === 'admin' && profile.role === 'vso') return '/admin/brigades'
  if (profile.kind === 'admin' && profile.role === 'brigadeAdmin' && profile.homeSlug) {
    return `/${profile.homeSlug}/admin`
  }
  return '/admin'
}

/** Whether the person has `/admin/brigades`: a superadmin or a VSO, not a Brigade Admin. */
export function hasBrigadeList(profile: AdminProfile): boolean {
  return profile.kind === 'superadmin' || (profile.kind === 'admin' && profile.role === 'vso')
}

export function canManage(profile: AdminProfile, brigadeId: string): boolean {
  if (profile.kind === 'superadmin') return true
  return profile.kind === 'admin' && profile.brigadeIds.includes(brigadeId)
}

/** Whether the person controls where and whether a brigade they manage has its reports emailed: not a Brigade Admin. */
export function canManageBrigadeSettings(profile: AdminProfile): boolean {
  return profile.kind === 'superadmin' || (profile.kind === 'admin' && profile.role === 'vso')
}

export function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

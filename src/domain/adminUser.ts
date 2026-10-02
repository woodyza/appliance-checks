import type { AdminRole } from './types'

export interface AdminUserDraft {
  email: string
  displayName: string
  role: AdminRole
  brigadeIds: string[]
}

export interface NormalisedAdminUser {
  email: string
  displayName: string | null
  role: AdminRole
  brigadeIds: string[]
}

export type NormaliseAdminUserResult = { ok: true; user: NormalisedAdminUser } | { ok: false; problem: string }

function isValidEmail(email: string): boolean {
  const parts = email.split('@')
  return parts.length === 2 && parts[0] !== '' && parts[1] !== ''
}

export function normaliseAdminUser(draft: AdminUserDraft): NormaliseAdminUserResult {
  const email = draft.email.trim().toLowerCase()
  if (!isValidEmail(email)) return { ok: false, problem: 'Enter an email address.' }

  const brigadeIds = [...new Set(draft.brigadeIds)]
  if (draft.role === 'brigadeAdmin' && brigadeIds.length !== 1) {
    return { ok: false, problem: 'A Brigade Admin has exactly one brigade.' }
  }
  if (draft.role === 'vso' && brigadeIds.length === 0) {
    return { ok: false, problem: 'Pick at least one brigade.' }
  }

  const displayName = draft.displayName.trim() || null

  return { ok: true, user: { email, displayName, role: draft.role, brigadeIds } }
}

import { readFileSync, writeFileSync } from 'node:fs'

const PATH = '.firebaserc'

export interface Firebaserc {
  projects?: Record<string, string>
  [key: string]: unknown
}

export function readFirebaserc(): Firebaserc | null {
  let raw: string
  try {
    raw = readFileSync(PATH, 'utf8')
  } catch {
    return null
  }
  return JSON.parse(raw) as Firebaserc
}

export function writeFirebaserc(rc: Firebaserc): void {
  writeFileSync(PATH, `${JSON.stringify(rc, null, 2)}\n`)
}

export function withAlias(rc: Firebaserc, alias: string, projectId: string): Firebaserc {
  const existing = rc.projects?.[alias]
  if (existing !== undefined && existing !== projectId) {
    throw new Error(
      `.firebaserc alias "${alias}" already points at "${existing}". ` +
        'Edit .firebaserc yourself if you really mean to switch projects.',
    )
  }
  return { ...rc, projects: { ...rc.projects, [alias]: projectId } }
}

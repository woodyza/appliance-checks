import { describe, expect, it } from 'vitest'
import { withAlias } from '../../../cli/lib/firebaserc'

describe('withAlias', () => {
  it('adds the alias and keeps other aliases and top-level keys', () => {
    const rc = { projects: { dev: 'checks-dev' }, targets: { x: 1 } }

    expect(withAlias(rc, 'prod', 'checks-prod')).toEqual({
      projects: { dev: 'checks-dev', prod: 'checks-prod' },
      targets: { x: 1 },
    })
  })

  it('refuses to repoint an existing alias at a different project', () => {
    const rc = { projects: { dev: 'checks-dev' } }

    expect(() => withAlias(rc, 'dev', 'other-dev')).toThrow(/already points at "checks-dev"/)
  })
})

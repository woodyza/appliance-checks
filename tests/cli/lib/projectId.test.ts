import { describe, expect, it } from 'vitest'
import { hasRandomSuffix } from '../../../cli/lib/projectId'

describe('hasRandomSuffix', () => {
  it.each(['appliance-checks-7f3kq2', 'checks-a1b2'])('accepts %s', (projectId) => {
    expect(hasRandomSuffix(projectId)).toBe(true)
  })

  it.each(['appliance-checks-prod', 'appliance-checks-2026', 'appliance-checks-a1'])('rejects %s', (projectId) => {
    expect(hasRandomSuffix(projectId)).toBe(false)
  })
})

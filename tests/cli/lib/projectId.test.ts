import { describe, expect, it } from 'vitest'
import { hasRandomSuffix, pickLabelledProject, provisionProjectId } from '../../../cli/lib/projectId'

describe('pickLabelledProject', () => {
  it('returns the only labelled project', () => {
    expect(pickLabelledProject('dev', ['a-dev'])).toBe('a-dev')
  })

  it('says how to label a project when there are none', () => {
    expect(() => pickLabelledProject('dev', [])).toThrow(/make provision ENV=dev PROJECT_ID/)
  })

  it('lists every project when more than one is labelled', () => {
    expect(() => pickLabelledProject('dev', ['a-dev', 'b-dev'])).toThrow(/a-dev, b-dev/)
  })
})

describe('provisionProjectId', () => {
  it('uses the requested id when nothing is labelled yet', () => {
    expect(provisionProjectId('dev', 'new-id', [])).toBe('new-id')
  })

  it('uses the requested id when it is the labelled project', () => {
    expect(provisionProjectId('dev', 'a-dev', ['a-dev'])).toBe('a-dev')
  })

  it('refuses a requested id when another project already has the label', () => {
    expect(() => provisionProjectId('dev', 'new-id', ['a-dev'])).toThrow(/a-dev/)
  })

  it('falls back to the labelled project when no id is requested', () => {
    expect(provisionProjectId('dev', undefined, ['a-dev'])).toBe('a-dev')
  })

  it('asks for --project-id when none is requested or labelled', () => {
    expect(() => provisionProjectId('dev', undefined, [])).toThrow(/--project-id is required/)
  })
})

describe('hasRandomSuffix', () => {
  it.each(['checks-x9y8z7', 'checks-a1b2'])('accepts %s', (projectId) => {
    expect(hasRandomSuffix(projectId)).toBe(true)
  })

  it.each(['appliance-checks-prod', 'appliance-checks-2026', 'appliance-checks-a1'])('rejects %s', (projectId) => {
    expect(hasRandomSuffix(projectId)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { findKillSwitchBudget } from '../../../cli/lib/billing'

const NAME = 'appliance-checks-kill-switch-dev'

describe('findKillSwitchBudget', () => {
  it('finds the budget with the name that is filtered to the project', () => {
    const budget = { name: 'billingAccounts/A/budgets/1', displayName: NAME, budgetFilter: { projects: ['projects/123'] } }

    expect(findKillSwitchBudget([budget], NAME, '123')).toEqual(budget)
  })

  it('ignores a budget with the same name filtered to another project', () => {
    const budget = { name: 'billingAccounts/A/budgets/1', displayName: NAME, budgetFilter: { projects: ['projects/456'] } }

    expect(findKillSwitchBudget([budget], NAME, '123')).toBeNull()
  })
})

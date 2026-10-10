import { describe, expect, it, vi } from 'vitest'
import { applyBudgetNotification } from '../../functions/src/killSwitch'

describe('applyBudgetNotification', () => {
  it('unlinks billing once the cost is over the budget', async () => {
    const unlink = vi.fn(async () => {})

    const outcome = await applyBudgetNotification({ costAmount: 11, budgetAmount: 10, currencyCode: 'NZD' }, unlink)

    expect(unlink).toHaveBeenCalledOnce()
    expect(outcome).toEqual({ action: 'unlinked', costAmount: 11, budgetAmount: 10, currencyCode: 'NZD' })
  })

  it('leaves billing alone when the cost is exactly at the budget', async () => {
    const unlink = vi.fn(async () => {})

    const outcome = await applyBudgetNotification({ costAmount: 10, budgetAmount: 10 }, unlink)

    expect(unlink).not.toHaveBeenCalled()
    expect(outcome.action).toBe('under-budget')
  })

  it('leaves billing alone when an amount is missing', async () => {
    const unlink = vi.fn(async () => {})

    const outcome = await applyBudgetNotification({ budgetAmount: 10 }, unlink)

    expect(unlink).not.toHaveBeenCalled()
    expect(outcome.action).toBe('invalid')
  })

  it('leaves billing alone when an amount is not a number', async () => {
    const unlink = vi.fn(async () => {})

    const outcome = await applyBudgetNotification({ costAmount: '11', budgetAmount: 10 }, unlink)

    expect(unlink).not.toHaveBeenCalled()
    expect(outcome.action).toBe('invalid')
  })
})

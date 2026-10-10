export const KILL_SWITCH_TOPIC = 'billing-kill-switch'
export const KILL_SWITCH_SERVICE_ACCOUNT_ID = 'billing-kill-switch'

export type KillSwitchOutcome =
  | { action: 'unlinked' | 'under-budget'; costAmount: number; budgetAmount: number; currencyCode?: unknown }
  | { action: 'invalid'; notification: unknown }

// Budgets publish several times a day whatever the spend. A garbled notification never unlinks:
// taking the site down on one seems worse than missing it, since the next one comes within hours.
export async function applyBudgetNotification(
  notification: unknown,
  unlink: () => Promise<void>,
): Promise<KillSwitchOutcome> {
  const { costAmount, budgetAmount, currencyCode } = (notification ?? {}) as Record<string, unknown>
  if (typeof costAmount !== 'number' || typeof budgetAmount !== 'number') {
    return { action: 'invalid', notification }
  }
  if (costAmount <= budgetAmount) return { action: 'under-budget', costAmount, budgetAmount, currencyCode }
  await unlink()
  return { action: 'unlinked', costAmount, budgetAmount, currencyCode }
}

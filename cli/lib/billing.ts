import { capture } from './shell'

export interface KillSwitchBudget {
  name: string
  displayName?: string
  budgetFilter?: { projects?: string[] }
}

export function billingEnabled(projectId: string): boolean {
  const described = capture('gcloud', ['billing', 'projects', 'describe', projectId, '--format=value(billingEnabled)'])
  if (!described.ok) {
    throw new Error(`Could not read the billing status of ${projectId}: ${described.stderr || described.stdout}`)
  }
  return described.stdout === 'True'
}

// `billingAccounts/<id>`, for a project with billing enabled.
export function billingAccount(projectId: string): string {
  const described = capture('gcloud', ['billing', 'projects', 'describe', projectId, '--format=value(billingAccountName)'])
  if (!described.ok || !described.stdout) {
    throw new Error(`Could not read the billing account of ${projectId}: ${described.stderr || described.stdout}`)
  }
  return described.stdout
}

// Per env, since `dev` and `prod` may share a billing account and the budget emails only name the budget.
export function killSwitchBudgetName(env: string): string {
  return `appliance-checks-kill-switch-${env}`
}

// Budgets live on the billing account, not the project; `--billing-project` gives gcloud's
// user credentials a quota project for the Budget API.
export function listBudgets(account: string, projectId: string): KillSwitchBudget[] {
  const listed = capture('gcloud', [
    'billing', 'budgets', 'list', `--billing-account=${account}`, `--billing-project=${projectId}`, '--format=json',
  ])
  if (!listed.ok) {
    throw new Error(
      `Could not list the budgets on ${account}: ${listed.stderr}\n` +
        'This needs Billing Account Viewer (or higher) on the billing account; see docs/infra-setup.md.',
    )
  }
  return JSON.parse(listed.stdout) as KillSwitchBudget[]
}

// The API stores the project filter by number, whatever it was created with.
export function findKillSwitchBudget(
  budgets: KillSwitchBudget[],
  displayName: string,
  projectNumber: string,
): KillSwitchBudget | null {
  return (
    budgets.find(
      (budget) =>
        budget.displayName === displayName && (budget.budgetFilter?.projects ?? []).includes(`projects/${projectNumber}`),
    ) ?? null
  )
}

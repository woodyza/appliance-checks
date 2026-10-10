import { KILL_SWITCH_SERVICE_ACCOUNT_ID, KILL_SWITCH_TOPIC } from '../../functions/src/killSwitch'
import { billingAccount, findKillSwitchBudget, killSwitchBudgetName, listBudgets } from './billing'
import { projectNumber } from './projectId'
import { secretExists } from './secrets'
import { capture } from './shell'

export const GMAIL_SECRET_NAME = 'GMAIL_APP_PASSWORD'
export const MAIL_FROM_SECRET_NAME = 'MAIL_FROM'

export function killSwitchServiceAccount(projectId: string): string {
  return `${KILL_SWITCH_SERVICE_ACCOUNT_ID}@${projectId}.iam.gserviceaccount.com`
}

export function topicExists(projectId: string): boolean {
  return capture('gcloud', ['pubsub', 'topics', 'describe', KILL_SWITCH_TOPIC, `--project=${projectId}`]).ok
}

export function serviceAccountExists(projectId: string): boolean {
  return capture('gcloud', ['iam', 'service-accounts', 'describe', killSwitchServiceAccount(projectId), `--project=${projectId}`]).ok
}

// What `make provision` sets up that the functions deploy needs, so a deploy before provision
// stops early instead of failing partway through, or deploying a kill switch no budget feeds.
export function missingFunctionsSetup(env: string, projectId: string): string[] {
  const missing = [GMAIL_SECRET_NAME, MAIL_FROM_SECRET_NAME]
    .filter((name) => !secretExists(projectId, name))
    .map((name) => `the ${name} secret`)
  if (!topicExists(projectId)) missing.push(`the ${KILL_SWITCH_TOPIC} topic`)
  if (!serviceAccountExists(projectId)) missing.push(`the ${KILL_SWITCH_SERVICE_ACCOUNT_ID} service account`)
  // Anything missing already means "run provision"; listing budgets before provision has enabled
  // the Budget API would fail with an unhelpful SERVICE_DISABLED instead.
  if (missing.length > 0) return missing
  const budgetName = killSwitchBudgetName(env)
  const budgets = listBudgets(billingAccount(projectId), projectId)
  if (!findKillSwitchBudget(budgets, budgetName, projectNumber(projectId))) missing.push(`the ${budgetName} budget`)
  return missing
}

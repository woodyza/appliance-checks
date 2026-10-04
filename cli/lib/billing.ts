import { capture } from './shell'

export function billingEnabled(projectId: string): boolean {
  const described = capture('gcloud', ['billing', 'projects', 'describe', projectId, '--format=value(billingEnabled)'])
  if (!described.ok) {
    throw new Error(`Could not read the billing status of ${projectId}: ${described.stderr || described.stdout}`)
  }
  return described.stdout === 'True'
}

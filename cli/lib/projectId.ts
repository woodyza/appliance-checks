import { capture } from './shell'

export const ENV_LABEL = 'appliance-checks-env'

export function hasRandomSuffix(projectId: string): boolean {
  const suffix = projectId.split('-').pop() ?? ''
  return suffix.length >= 4 && /[a-z]/.test(suffix) && /[0-9]/.test(suffix)
}

export function labelledProjectIds(env: string): string[] {
  const listed = capture('gcloud', [
    'projects', 'list', `--filter=labels.${ENV_LABEL}=${env} AND lifecycleState=ACTIVE`, '--format=value(projectId)',
  ])
  if (!listed.ok) throw new Error(`Could not list projects labelled ${ENV_LABEL}=${env}: ${listed.stderr}`)
  return listed.stdout.split('\n').filter((id) => id !== '')
}

export function pickLabelledProject(env: string, ids: string[]): string {
  if (ids.length === 0) {
    throw new Error(`No project is labelled \`${ENV_LABEL}=${env}\`: run \`make provision ENV=${env} PROJECT_ID=<id>\`.`)
  }
  if (ids.length > 1) {
    throw new Error(
      `More than one project is labelled \`${ENV_LABEL}=${env}\`: ${ids.join(', ')}. ` +
        'Remove the label from the extras in the console (IAM & Admin → Labels).',
    )
  }
  return ids[0]
}

export function provisionProjectId(env: string, requested: string | undefined, ids: string[]): string {
  if (requested === undefined) {
    if (ids.length === 0) {
      throw new Error(`--project-id is required: no project is labelled \`${ENV_LABEL}=${env}\` yet.`)
    }
    return pickLabelledProject(env, ids)
  }
  if (ids.some((id) => id !== requested)) {
    throw new Error(
      `${ids.join(', ')} is already labelled \`${ENV_LABEL}=${env}\`, so ${requested} would be a second ${env} project. ` +
        'Remove the label from the old project first if you mean to switch.',
    )
  }
  return requested
}

import { capture } from './shell'

export function assertNoFirebaseToken(): void {
  if (process.env.FIREBASE_TOKEN) {
    throw new Error(
      'FIREBASE_TOKEN is set: the Firebase CLI would authenticate with that token instead of the account ' +
        'shown by `firebase login:list`. Unset it first.',
    )
  }
}

export function firebaseCliAccount(): string {
  const match = /Logged in as (\S+)/.exec(capture('npx', ['firebase', 'login:list']).stdout)
  if (!match) {
    throw new Error('No Firebase CLI account is logged in. Run `npx firebase login` first.')
  }
  return match[1]
}

const GCLOUD_CREDENTIAL_OVERRIDES = ['CLOUDSDK_AUTH_ACCESS_TOKEN_FILE', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE']

export function gcloudAccount(): string {
  const override = GCLOUD_CREDENTIAL_OVERRIDES.find((name) => process.env[name])
  if (override) {
    throw new Error(`${override} is set: gcloud would ignore the active account. Unset it first.`)
  }
  const account = capture('gcloud', ['config', 'get-value', 'account']).stdout
  if (!account) {
    throw new Error('No active gcloud account. Run `gcloud auth login` first.')
  }
  return account
}

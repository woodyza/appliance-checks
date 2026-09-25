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

export function gcloudAccount(): string {
  const account = capture('gcloud', ['config', 'get-value', 'account']).stdout
  if (!account || account === '(unset)') {
    throw new Error('No active gcloud account. Run `gcloud auth login` first.')
  }
  return account
}

import {
  type AuthError,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { ref } from 'vue'
import { auth } from '../firebase'

const STORED_EMAIL_KEY = 'admin-sign-in-email'

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-action-code': 'This link has expired. Request another.',
  'auth/expired-action-code': 'This link has expired. Request another.',
  'auth/quota-exceeded': 'Sign-in emails are used up for today. Try again tomorrow.',
}

export const currentUser = ref<User | null>(null)

let resolveReady: (user: User | null) => void
const readyPromise = new Promise<User | null>((resolve) => {
  resolveReady = resolve
})
let readySettled = false

onAuthStateChanged(auth, (user) => {
  currentUser.value = user
  if (!readySettled) {
    readySettled = true
    resolveReady(user)
  }
})

/** Resolves with the user once the first `onAuthStateChanged` result has landed. */
export function authReady(): Promise<User | null> {
  return readyPromise
}

export function authErrorMessage(error: unknown): string {
  const code = (error as AuthError | undefined)?.code
  return (code && ERROR_MESSAGES[code]) || 'Something went wrong. Try again.'
}

export async function sendLink(email: string): Promise<void> {
  await sendSignInLinkToEmail(auth, email, {
    url: `${window.location.origin}/admin/sign-in`,
    handleCodeInApp: true,
  })
  window.localStorage.setItem(STORED_EMAIL_KEY, email)
}

export function isSignInLink(url: string): boolean {
  return isSignInWithEmailLink(auth, url)
}

export function storedEmail(): string | null {
  return window.localStorage.getItem(STORED_EMAIL_KEY)
}

export function clearStoredEmail(): void {
  window.localStorage.removeItem(STORED_EMAIL_KEY)
}

// Sets `currentUser` immediately from the sign-in result, rather than waiting for the
// `onAuthStateChanged` callback to fire, so a caller that navigates straight to `/admin`
// doesn't race the auth guard there.
export async function completeSignIn(email: string, url: string): Promise<User> {
  const credential = await signInWithEmailLink(auth, email, url)
  currentUser.value = credential.user
  clearStoredEmail()
  return credential.user
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth)
}

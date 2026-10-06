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
import { getAdminUser, listBrigadesById } from '../data/admin'
import { type AdminProfile, adminHomePath } from '../domain/adminProfile'
import type { AdminUser } from '../domain/types'
import { auth } from '../firebase'
import { isPermissionDenied } from './permissionDenied'

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

let cachedProfile: { uid: string; profile: Promise<AdminProfile> } | null = null

function clearProfileCacheUnless(uid: string | undefined): void {
  if (cachedProfile && cachedProfile.uid !== uid) cachedProfile = null
}

onAuthStateChanged(auth, (user) => {
  clearProfileCacheUnless(user?.uid)
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
  clearProfileCacheUnless(credential.user.uid)
  currentUser.value = credential.user
  clearStoredEmail()
  return credential.user
}

// Clears `currentUser` straight away, for the same reason `completeSignIn` sets it: a caller
// that navigates to `/admin/sign-in` next mustn't be redirected back by the signed-in guard.
export async function signOut(): Promise<void> {
  await firebaseSignOut(auth)
  cachedProfile = null
  currentUser.value = null
}

async function resolveAdminProfile(user: User): Promise<AdminProfile> {
  const superadminUid = import.meta.env.VITE_SUPERADMIN_UID
  if (superadminUid && user.uid === superadminUid) return { kind: 'superadmin' }
  if (!user.email) return { kind: 'none' }

  let adminUser: AdminUser | null
  try {
    adminUser = await getAdminUser(user.email.toLowerCase())
  } catch (error) {
    if (isPermissionDenied(error)) return { kind: 'none' }
    throw error
  }
  if (!adminUser) return { kind: 'none' }

  if (adminUser.role === 'vso') {
    return { kind: 'admin', role: 'vso', brigadeIds: adminUser.brigadeIds, homeSlug: null }
  }
  const [brigadeId] = adminUser.brigadeIds
  const home = brigadeId ? (await listBrigadesById([brigadeId]))[0] : undefined
  if (!home) return { kind: 'none' }
  return { kind: 'admin', role: 'brigadeAdmin', brigadeIds: adminUser.brigadeIds, homeSlug: home.slug }
}

/** What the signed-in person may administer, cached per user. Rejects (and retries on the next call) if it can't be read. */
export function adminProfile(): Promise<AdminProfile> {
  const user = currentUser.value
  if (!user) return Promise.reject(new Error('Not signed in.'))
  if (cachedProfile?.uid === user.uid) return cachedProfile.profile

  const profile = resolveAdminProfile(user)
  const entry = { uid: user.uid, profile }
  cachedProfile = entry
  profile.catch(() => {
    if (cachedProfile === entry) cachedProfile = null
  })
  return profile
}

/** Where a signed-in person's admin screens start; the hub if their profile can't be read. */
export async function adminHome(): Promise<string> {
  try {
    return adminHomePath(await adminProfile())
  } catch {
    return '/admin'
  }
}

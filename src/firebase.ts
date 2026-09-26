import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { connectFirestoreEmulator, type Firestore, getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const useEmulator = import.meta.env.VITE_USE_EMULATOR === 'true'

const app = initializeApp(firebaseConfig)

if (!useEmulator) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  })
}

export const db: Firestore = getFirestore(app)

if (useEmulator) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}

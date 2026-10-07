<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  adminHome,
  authErrorMessage,
  clearStoredEmail,
  completeSignIn,
  currentUser,
  isSignInLink,
  sendLink,
  signOut,
  storedEmail,
} from '../../state/auth'

type Stage = 'loading' | 'enterEmail' | 'linkSent' | 'confirmEmail' | 'error'

const router = useRouter()
const stage = ref<Stage>('loading')
const email = ref('')
const errorMessage = ref('')

async function completeFromLink(knownEmail: string): Promise<void> {
  try {
    await completeSignIn(knownEmail, window.location.href)
    await router.replace(await adminHome())
  } catch (error) {
    clearStoredEmail()
    // A later request on this device overwrote the stored email, so ask for the one this link is for.
    if ((error as { code?: string }).code === 'auth/invalid-email') {
      stage.value = 'confirmEmail'
      return
    }
    stage.value = 'error'
    errorMessage.value = authErrorMessage(error)
  }
}

onMounted(async () => {
  if (!isSignInLink(window.location.href)) {
    stage.value = 'enterEmail'
    return
  }

  const stored = storedEmail()
  if (stored) {
    await completeFromLink(stored)
  } else {
    // The link was opened on a different device from the one that requested it.
    stage.value = 'confirmEmail'
  }
})

async function requestLink(): Promise<void> {
  try {
    await sendLink(email.value)
    stage.value = 'linkSent'
  } catch (error) {
    stage.value = 'error'
    errorMessage.value = authErrorMessage(error)
  }
}

// Signs out first: someone still signed in after a failed link would otherwise be redirected to
// their old account's admin home instead of getting the email form.
async function requestAnother(): Promise<void> {
  if (currentUser.value) await signOut()
  await router.replace('/admin/sign-in')
  stage.value = 'enterEmail'
}

async function confirmEmailAndSignIn(): Promise<void> {
  await completeFromLink(email.value)
}
</script>

<template>
  <div id="app">
    <header>
      <div class="header-titles">
        <div class="header-callsign">
          Admin sign-in
        </div>
      </div>
    </header>

    <div
      v-if="stage === 'loading'"
      class="screen active screen-loading"
    >
      <div class="spinner" />
      <div class="loading-text">
        Signing in…
      </div>
    </div>

    <div
      v-else-if="stage === 'error'"
      class="screen active screen-error"
    >
      <div class="error-icon">
        ⚠️
      </div>
      <div class="error-msg">
        {{ errorMessage }}
      </div>
      <button
        class="retry-btn"
        @click="requestAnother"
      >
        Request another link
      </button>
    </div>

    <div
      v-else-if="stage === 'linkSent'"
      class="screen active screen-picker"
    >
      <div class="picker-heading">
        Check your inbox
      </div>
      <p class="error-msg">
        We've sent a sign-in link to {{ email }}.
      </p>
    </div>

    <form
      v-else-if="stage === 'enterEmail'"
      class="screen active screen-picker"
      @submit.prevent="requestLink"
    >
      <div class="picker-heading">
        Sign in
      </div>
      <input
        v-model="email"
        type="email"
        required
        placeholder="you@example.com"
        class="item-input"
      >
      <button
        type="submit"
        class="small-btn fit-btn positive"
      >
        Send sign-in link
      </button>
    </form>

    <form
      v-else-if="stage === 'confirmEmail'"
      class="screen active screen-picker"
      @submit.prevent="confirmEmailAndSignIn"
    >
      <div class="picker-heading">
        Confirm your email
      </div>
      <p class="error-msg">
        Enter the email you requested the link with to finish signing in.
      </p>
      <input
        v-model="email"
        type="email"
        required
        placeholder="you@example.com"
        class="item-input"
      >
      <button
        type="submit"
        class="small-btn fit-btn positive"
      >
        Continue
      </button>
    </form>
  </div>
</template>

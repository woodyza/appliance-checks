<script setup lang="ts">
import { useRouter } from 'vue-router'
import { currentUser, signOut } from '../state/auth'

defineProps<{
  title: string
  loading: boolean
  notAuthorised: boolean
  error: string | null
  up?: { to: string; label: string }
  showSignOut?: boolean
}>()

const router = useRouter()

async function handleSignOut(): Promise<void> {
  await signOut()
  await router.replace('/admin/sign-in')
}
</script>

<template>
  <div id="app">
    <header>
      <router-link
        v-if="up"
        :to="up.to"
        class="header-back header-up"
      >
        {{ up.label }}
      </router-link>
      <div class="header-titles">
        <div class="header-callsign">
          {{ title }}
        </div>
      </div>
      <button
        v-if="showSignOut"
        class="header-back"
        @click="handleSignOut"
      >
        Sign out
      </button>
    </header>

    <div
      v-if="loading"
      class="screen active screen-loading"
    >
      <div class="spinner" />
      <div class="loading-text">
        Loading…
      </div>
    </div>

    <div
      v-else-if="notAuthorised"
      class="screen active screen-error not-authorised"
    >
      <div class="error-icon">
        ⚠️
      </div>
      <div class="error-msg">
        Not authorised.<br>
        UID: {{ currentUser?.uid }}
      </div>
    </div>

    <div
      v-else-if="error"
      class="screen active screen-error"
    >
      <div class="error-icon">
        ⚠️
      </div>
      <div class="error-msg">
        {{ error }}
      </div>
    </div>

    <slot v-else />
  </div>
</template>

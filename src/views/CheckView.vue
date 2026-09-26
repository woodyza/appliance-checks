<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CHECK_SESSION_KEY, useCheckSession } from '../state/checkSession'

const route = useRoute()
const router = useRouter()
const slug = route.params.slug as string
const applianceId = route.params.applianceId as string

const selected = ref<string | null>(typeof route.query.check === 'string' ? route.query.check : null)

const session = useCheckSession(slug, applianceId, selected)
provide(CHECK_SESSION_KEY, session)

watch(
  () => route.query.check,
  (value) => {
    selected.value = typeof value === 'string' ? value : null
  },
)

watch(
  [session.loading, session.selectedDate],
  ([loading, date]) => {
    // Don't sync a transient default computed before the initial load finishes: once it lands in
    // the URL and matches an existing selector date, selectedDate would lock onto it and never
    // correct itself when the real default turns out to be different. Watching `loading`
    // alongside it (rather than `selectedDate` alone) makes sure the URL still gets the final
    // value once loading settles, even when that value happens to match the transient one.
    if (loading) return
    if (route.query.check !== date) {
      void router.replace({ query: { ...route.query, check: date } })
    }
  },
  { immediate: true },
)

function onSelectorChange(event: Event): void {
  session.select((event.target as HTMLSelectElement).value)
}

function formatSelectorLabel(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year.slice(2)}`
}

const isSection = computed(() => route.name === 'sectionView')

// Only show the loading screen before the session has ever been ready for a selection. Writes
// stay gated on `ready` itself (see checkSession.ts): once something is on screen, later
// re-gating (a Check switch or version bump whose stamped version isn't cached yet) must not
// swap the rendered view out for a spinner, which would close the keyboard and drop in-flight
// input.
const showLoading = computed(() => session.loading.value || (!session.everReady.value && !session.error.value))

function switchAppliance(): void {
  void router.push(`/${slug}`)
}

function backToSections(): void {
  void router.push({ path: `/${slug}/${applianceId}`, query: route.query })
}

function optIn(): void {
  void session.optIn()
}
</script>

<template>
  <div id="app">
    <header>
      <button
        v-if="isSection"
        class="header-back"
        @click="backToSections"
      >
        Back
      </button>
      <button
        v-else
        class="header-back"
        @click="switchAppliance"
      >
        Switch
      </button>
      <div class="header-titles">
        <div class="header-callsign">
          {{ session.appliance.value?.callsign ?? 'Appliance Checks' }}
        </div>
      </div>
      <div
        v-if="!session.loading.value && !session.error.value"
        class="week-selector-wrap"
      >
        <span class="week-selector-label">Check</span>
        <select
          class="week-selector"
          :value="session.selectedDate.value"
          @change="onSelectorChange"
        >
          <option
            v-for="date in session.selectorDates.value"
            :key="date"
            :value="date"
          >
            {{ formatSelectorLabel(date) }}
          </option>
        </select>
      </div>
    </header>

    <div
      v-if="showLoading"
      class="screen active screen-loading"
    >
      <div class="spinner" />
      <div class="loading-text">
        Loading…
      </div>
    </div>
    <div
      v-else-if="session.error.value === 'not-found'"
      class="screen active screen-error"
    >
      <div class="error-icon">
        ⚠️
      </div>
      <div class="error-msg">
        Appliance not found.
      </div>
      <router-link
        class="retry-btn"
        :to="`/${slug}`"
      >
        Back to appliance list
      </router-link>
    </div>
    <div
      v-else-if="session.error.value"
      class="screen active screen-error"
    >
      <div class="error-icon">
        ⚠️
      </div>
      <div class="error-msg">
        {{ session.error.value }}
      </div>
    </div>
    <template v-else>
      <div
        v-if="session.canOptIn.value"
        class="check-type-banner"
      >
        <div class="check-type-left">
          <div class="check-type-desc">
            This Check uses an older Check Sheet
          </div>
        </div>
        <button
          class="refresh-btn"
          @click="optIn"
        >
          Update to latest Check Sheet
        </button>
      </div>
      <router-view />
    </template>

    <div
      id="toast"
      :class="{ show: session.toast.value, error: session.toast.value?.isError }"
    >
      {{ session.toast.value?.text }}
    </div>
  </div>
</template>

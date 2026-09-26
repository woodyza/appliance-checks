<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { type ApplianceSummary, getBrigade, listAppliances } from '../data/checks'
import type { Brigade } from '../domain/types'

const route = useRoute()
const slug = route.params.slug as string

const brigade = ref<Brigade | null>(null)
const appliances = ref<ApplianceSummary[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const [brigadeDoc, applianceList] = await Promise.all([getBrigade(slug), listAppliances(slug)])
    if (!brigadeDoc || !brigadeDoc.active) {
      error.value = "This link isn't valid."
      return
    }
    brigade.value = brigadeDoc
    appliances.value = applianceList
  } catch {
    error.value = 'Could not load this brigade.'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div id="app">
    <header>
      <div class="header-titles">
        <div class="header-callsign">
          {{ brigade?.name ?? 'Appliance Checks' }}
        </div>
      </div>
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
    <div
      v-else
      class="screen active screen-picker"
    >
      <div class="picker-heading">
        Select appliance
      </div>
      <router-link
        v-for="appliance in appliances"
        :key="appliance.id"
        :to="`/${slug}/${appliance.id}`"
        class="appliance-card"
      >
        <div class="appliance-card-name">
          {{ appliance.callsign }}
        </div>
        <div class="section-chevron">
          <span class="chev chev-right" />
        </div>
      </router-link>
    </div>
  </div>
</template>

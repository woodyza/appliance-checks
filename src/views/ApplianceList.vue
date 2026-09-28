<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { type ApplianceSummary, getBrigade, listAppliances } from '../data/checks'
import type { Brigade } from '../domain/types'
import { currentUser } from '../state/auth'

const route = useRoute()
const slug = route.params.slug as string

const brigade = ref<Brigade | null>(null)
const appliances = ref<ApplianceSummary[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const inactive = computed(() => brigade.value !== null && !brigade.value.active)

onMounted(async () => {
  try {
    const [brigadeDoc, applianceList] = await Promise.all([getBrigade(slug), listAppliances(slug)])
    if (!brigadeDoc) {
      error.value = "This link isn't valid."
      return
    }
    brigade.value = brigadeDoc
    if (brigadeDoc.active) appliances.value = applianceList
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
      <router-link
        v-if="currentUser && brigade"
        :to="`/${slug}/admin`"
        class="header-back"
      >
        Admin
      </router-link>
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
      v-else-if="inactive"
      class="screen active screen-picker"
    >
      <p class="error-msg">
        Checks are disabled for this brigade.
      </p>
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

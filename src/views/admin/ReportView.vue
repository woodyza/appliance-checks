<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { type BrigadeSummary, listBrigades, listChecksInMonth } from '../../data/admin'
import { type ApplianceSummary, getVersion, listAppliances } from '../../data/checks'
import { buildMonthlyReport } from '../../domain/report'
import { recentMonths, today } from '../../domain/schedule'
import type { CheckSheetVersion } from '../../domain/types'
import { currentUser, signOut } from '../../state/auth'

interface Toast {
  text: string
  isError: boolean
}

const router = useRouter()

const loading = ref(true)
const error = ref<string | null>(null)
const notAuthorised = ref(false)

const brigades = ref<BrigadeSummary[]>([])
const selectedSlug = ref<string | null>(null)

const appliances = ref<ApplianceSummary[]>([])
const selectedApplianceId = ref<string | null>(null)

const months = recentMonths(today(), 12)
const selectedMonth = ref(months[1] ?? months[0])

const downloading = ref(false)
const toast = ref<Toast | null>(null)

const selectedBrigade = computed(() => brigades.value.find((entry) => entry.slug === selectedSlug.value) ?? null)
const selectedAppliance = computed(
  () => appliances.value.find((appliance) => appliance.id === selectedApplianceId.value) ?? null,
)
const noCheckSheet = computed(() => selectedAppliance.value !== null && selectedAppliance.value.currentCheckSheetVersion === null)
const canDownload = computed(
  () => !downloading.value && selectedBrigade.value !== null && selectedAppliance.value !== null && !noCheckSheet.value,
)

function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'permission-denied'
}

onMounted(async () => {
  try {
    brigades.value = await listBrigades()
    selectedSlug.value = brigades.value[0]?.slug ?? null
  } catch (err) {
    if (isPermissionDenied(err)) {
      notAuthorised.value = true
    } else {
      error.value = "Couldn't load brigades."
    }
  } finally {
    loading.value = false
  }
})

watch(selectedSlug, async (slug) => {
  if (!slug) {
    appliances.value = []
    selectedApplianceId.value = null
    return
  }
  try {
    appliances.value = await listAppliances(slug)
    selectedApplianceId.value = appliances.value[0]?.id ?? null
  } catch (err) {
    console.error(err)
    appliances.value = []
    selectedApplianceId.value = null
    showToast("Couldn't load appliances", true)
  }
})

function showToast(text: string, isError: boolean): void {
  toast.value = { text, isError }
  setTimeout(() => {
    toast.value = null
  }, 4000)
}

async function download(): Promise<void> {
  const brigadeSummary = selectedBrigade.value
  const appliance = selectedAppliance.value
  if (!brigadeSummary || !appliance || appliance.currentCheckSheetVersion === null) return
  const currentVersionNumber = appliance.currentCheckSheetVersion

  downloading.value = true
  try {
    const checks = await listChecksInMonth(brigadeSummary.slug, appliance.id, selectedMonth.value)
    const currentVersion = await getVersion(brigadeSummary.slug, appliance.id, currentVersionNumber)

    const neededVersionNumbers = new Set(checks.map((check) => check.checkSheetVersion))
    const versions = new Map<number, CheckSheetVersion>()
    for (const versionNumber of neededVersionNumbers) {
      versions.set(versionNumber, await getVersion(brigadeSummary.slug, appliance.id, versionNumber))
    }

    const report = buildMonthlyReport({
      brigade: brigadeSummary.brigade,
      appliance,
      month: selectedMonth.value,
      checks,
      versions,
      currentVersion,
      today: today(),
    })

    const { downloadMonthlyReport } = await import('../../report/pdf')
    await downloadMonthlyReport(report, new Date())
  } catch (err) {
    console.error(err)
    showToast("Couldn't load the report", true)
  } finally {
    downloading.value = false
  }
}

async function handleSignOut(): Promise<void> {
  await signOut()
  await router.replace('/admin/sign-in')
}
</script>

<template>
  <div id="app">
    <header>
      <div class="header-titles">
        <div class="header-callsign">
          Monthly Report
        </div>
      </div>
      <button
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

    <div
      v-else
      class="screen active screen-picker"
    >
      <div class="picker-heading">
        Brigade
      </div>
      <select
        v-model="selectedSlug"
        class="item-select brigade-select"
      >
        <option
          v-for="entry in brigades"
          :key="entry.slug"
          :value="entry.slug"
        >
          {{ entry.brigade.name }}
        </option>
      </select>

      <div class="picker-heading">
        Appliance
      </div>
      <select
        v-model="selectedApplianceId"
        class="item-select appliance-select"
      >
        <option
          v-for="appliance in appliances"
          :key="appliance.id"
          :value="appliance.id"
        >
          {{ appliance.callsign }}
        </option>
      </select>

      <div class="picker-heading">
        Month
      </div>
      <select
        v-model="selectedMonth"
        class="item-select month-select"
      >
        <option
          v-for="month in months"
          :key="month"
          :value="month"
        >
          {{ month }}
        </option>
      </select>

      <p
        v-if="noCheckSheet"
        class="error-msg no-check-sheet"
      >
        No Check Sheet yet.
      </p>

      <button
        class="copy-prev-btn download-btn"
        :disabled="!canDownload"
        @click="download"
      >
        {{ downloading ? 'Preparing…' : 'Download' }}
      </button>
    </div>

    <div
      id="toast"
      :class="{ show: toast, error: toast?.isError }"
    >
      {{ toast?.text }}
    </div>
  </div>
</template>

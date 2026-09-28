<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AdminFrame from '../../components/AdminFrame.vue'
import { listChecksInMonth } from '../../data/admin'
import { type ApplianceSummary, getVersion, listAppliances } from '../../data/checks'
import { buildMonthlyReport } from '../../domain/report'
import { recentMonths, today } from '../../domain/schedule'
import type { CheckSheetVersion } from '../../domain/types'
import { isPermissionDenied, useAdminGate } from '../../state/adminGate'

interface Toast {
  text: string
  isError: boolean
}

const route = useRoute()
const slug = route.params.slug as string

const gate = useAdminGate()

const appliances = ref<ApplianceSummary[]>([])
const selectedApplianceId = ref<string | null>(null)

const months = recentMonths(today(), 12)
const selectedMonth = ref(months[1] ?? months[0])

const downloading = ref(false)
const toast = ref<Toast | null>(null)

const brigadeSummary = computed(() => gate.brigades.value.find((entry) => entry.slug === slug) ?? null)
const invalidLink = computed(
  () => !gate.loading.value && !gate.notAuthorised.value && !gate.error.value && !brigadeSummary.value,
)
const frameError = computed(() => gate.error.value ?? (invalidLink.value ? "This link isn't valid." : null))

const selectedAppliance = computed(
  () => appliances.value.find((appliance) => appliance.id === selectedApplianceId.value) ?? null,
)
const noCheckSheet = computed(
  () => selectedAppliance.value !== null && selectedAppliance.value.currentCheckSheetVersion === null,
)
const canDownload = computed(
  () => !downloading.value && brigadeSummary.value !== null && selectedAppliance.value !== null && !noCheckSheet.value,
)

function showToast(text: string, isError: boolean): void {
  toast.value = { text, isError }
  setTimeout(() => {
    toast.value = null
  }, 4000)
}

watch(
  () => gate.loading.value,
  async (loading) => {
    if (loading || !brigadeSummary.value) return
    try {
      appliances.value = await listAppliances(slug)
      selectedApplianceId.value = appliances.value[0]?.id ?? null
    } catch (err) {
      console.error(err)
      appliances.value = []
      selectedApplianceId.value = null
      showToast("Couldn't load appliances", true)
    }
  },
  { immediate: true },
)

async function download(): Promise<void> {
  const summary = brigadeSummary.value
  const appliance = selectedAppliance.value
  if (!summary || !appliance || appliance.currentCheckSheetVersion === null) return
  const currentVersionNumber = appliance.currentCheckSheetVersion

  downloading.value = true
  try {
    const checks = await listChecksInMonth(summary.slug, appliance.id, selectedMonth.value)
    const currentVersion = await getVersion(summary.slug, appliance.id, currentVersionNumber)

    const neededVersionNumbers = new Set(checks.map((check) => check.checkSheetVersion))
    const versions = new Map<number, CheckSheetVersion>()
    for (const versionNumber of neededVersionNumbers) {
      versions.set(versionNumber, await getVersion(summary.slug, appliance.id, versionNumber))
    }

    const report = buildMonthlyReport({
      brigade: summary.brigade,
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
    showToast(isPermissionDenied(err) ? 'Not authorised.' : "Couldn't load the report", true)
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <AdminFrame
    :title="brigadeSummary?.brigade.name ?? 'Monthly Report'"
    :loading="gate.loading.value"
    :not-authorised="gate.notAuthorised.value"
    :error="frameError"
  >
    <div class="screen active screen-picker">
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
  </AdminFrame>
</template>

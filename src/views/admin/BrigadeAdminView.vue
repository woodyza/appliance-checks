<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminFrame from '../../components/AdminFrame.vue'
import { ApplianceIdTaken, addAppliance, getDraft, listAllAppliances } from '../../data/checkSheet'
import { listChecksInMonth } from '../../data/admin'
import { type ApplianceSummary, getVersion } from '../../data/checks'
import { applianceIdProblem, callsignProblem, suggestApplianceId } from '../../domain/appliance'
import { buildMonthlyReport } from '../../domain/report'
import { recentMonths, today } from '../../domain/schedule'
import type { CheckSheetVersion } from '../../domain/types'
import { isPermissionDenied, useAdminGate } from '../../state/adminGate'

interface Toast {
  text: string
  isError: boolean
}

const route = useRoute()
const router = useRouter()
const slug = route.params.slug as string

const gate = useAdminGate()

const appliances = ref<ApplianceSummary[]>([])
const hasDraft = ref(new Set<string>())
const draftsUnknown = ref(false)
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

function sheetStatus(appliance: ApplianceSummary): string {
  if (draftsUnknown.value) return "Couldn't check"
  if (hasDraft.value.has(appliance.id)) return 'Unpublished changes'
  return appliance.currentCheckSheetVersion === null ? 'No Check Sheet' : ''
}

async function loadDrafts(list: ApplianceSummary[]): Promise<void> {
  try {
    const flags = await Promise.all(list.map(async (appliance) => (await getDraft(slug, appliance.id)) !== null))
    hasDraft.value = new Set(list.filter((_, index) => flags[index]).map((appliance) => appliance.id))
  } catch (err) {
    console.error(err)
    draftsUnknown.value = true
  }
}

watch(
  () => gate.loading.value,
  async (loading) => {
    if (loading || !brigadeSummary.value) return
    try {
      appliances.value = await listAllAppliances(slug)
      selectedApplianceId.value = appliances.value[0]?.id ?? null
      await loadDrafts(appliances.value)
    } catch (err) {
      console.error(err)
      appliances.value = []
      selectedApplianceId.value = null
      showToast("Couldn't load appliances", true)
    }
  },
  { immediate: true },
)

const adding = ref(false)
const newCallsign = ref('')
const newId = ref('')
const idEdited = ref(false)
const submitted = ref(false)
const idTaken = ref(false)
const saving = ref(false)

watch(newCallsign, (callsign) => {
  if (!idEdited.value) newId.value = suggestApplianceId(callsign)
})

const callsignMessage = computed(() => (submitted.value || newCallsign.value ? callsignProblem(newCallsign.value) : null))
const idMessage = computed(() => {
  if (idTaken.value) return 'That id is already used'
  return submitted.value || newId.value ? applianceIdProblem(newId.value) : null
})

function startAdding(): void {
  adding.value = true
  newCallsign.value = ''
  newId.value = ''
  idEdited.value = false
  submitted.value = false
  idTaken.value = false
}

async function saveNew(): Promise<void> {
  submitted.value = true
  if (callsignProblem(newCallsign.value) || applianceIdProblem(newId.value) || saving.value) return
  saving.value = true
  idTaken.value = false
  try {
    await addAppliance(slug, newId.value, newCallsign.value.trim())
    await router.push(`/${slug}/admin/${newId.value}`)
  } catch (err) {
    if (err instanceof ApplianceIdTaken) {
      idTaken.value = true
    } else {
      console.error(err)
      showToast(isPermissionDenied(err) ? 'Not authorised.' : "Couldn't add the appliance", true)
    }
  } finally {
    saving.value = false
  }
}

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
    :title="brigadeSummary?.brigade.name ?? 'Brigade admin'"
    :up="{ to: `/${slug}`, label: '‹ Appliances' }"
    :loading="gate.loading.value"
    :not-authorised="gate.notAuthorised.value"
    :error="frameError"
  >
    <main class="admin-page admin-columns">
      <section class="admin-panel appliances-panel">
        <div class="picker-heading">
          Appliances
        </div>
        <div class="appliance-table">
          <router-link
            v-for="appliance in appliances"
            :key="appliance.id"
            :to="`/${slug}/admin/${appliance.id}`"
            :class="['appliance-row', appliance.active ? '' : 'inactive']"
          >
            <span class="appliance-row-callsign">{{ appliance.callsign }}</span>
            <span class="appliance-row-id">{{ appliance.id }}</span>
            <span class="appliance-row-active">{{ appliance.active ? 'Active' : 'Inactive' }}</span>
            <span class="appliance-row-status">{{ sheetStatus(appliance) }}</span>
          </router-link>

          <div
            v-if="adding"
            class="appliance-add"
          >
            <div class="add-fields">
              <input
                v-model="newCallsign"
                type="text"
                class="cell-input add-callsign"
                placeholder="Callsign"
                @keydown.enter.prevent="saveNew"
              >
              <input
                v-model="newId"
                type="text"
                class="cell-input add-id"
                placeholder="Id"
                @input="idEdited = true; idTaken = false"
                @keydown.enter.prevent="saveNew"
              >
            </div>
            <p
              v-if="callsignMessage"
              class="field-error"
            >
              {{ callsignMessage }}
            </p>
            <p
              v-if="idMessage"
              class="field-error id-error"
            >
              {{ idMessage }}
            </p>
            <div class="add-actions">
              <button
                class="small-btn primary add-save"
                :disabled="saving"
                @click="saveNew"
              >
                Save
              </button>
              <button
                class="small-btn add-cancel"
                @click="adding = false"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
        <button
          v-if="!adding"
          class="small-btn add-appliance"
          @click="startAdding"
        >
          + Add appliance
        </button>
      </section>

      <section class="admin-panel reports-panel">
        <div class="picker-heading">
          Reports
        </div>
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
            {{ appliance.callsign }}{{ appliance.active ? '' : ' (inactive)' }}
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
      </section>
    </main>

    <div
      id="toast"
      :class="{ show: toast, error: toast?.isError }"
    >
      {{ toast?.text }}
    </div>
  </AdminFrame>
</template>

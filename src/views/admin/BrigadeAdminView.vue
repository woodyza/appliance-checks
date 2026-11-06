<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrigadeDetailsForm from '../../components/admin/BrigadeDetailsForm.vue'
import AdminFrame from '../../components/AdminFrame.vue'
import AdminIcon from '../../components/AdminIcon.vue'
import { ApplianceIdTaken, addAppliance, getDraft } from '../../data/checkSheet'
import {
  type BrigadeSummary,
  getBrigadeSettings,
  getMonthlyReportSettings,
  listChecksInMonth,
  updateBrigade,
} from '../../data/admin'
import { type ApplianceSummary, getVersion } from '../../data/checks'
import { canManageBrigadeSettings, hasBrigadeList } from '../../domain/adminProfile'
import { applianceIdProblem, callsignProblem, suggestApplianceId } from '../../domain/appliance'
import type { BrigadeDraft, NormalisedBrigade, NormalisedReportSettings, ReportSettingsDraft } from '../../domain/brigade'
import { buildMonthlyReport } from '../../domain/report'
import { recentMonths, today } from '../../domain/schedule'
import type { BrigadeSettings, CheckSheetVersion } from '../../domain/types'
import { wantsWeeklyEmail } from '../../domain/weeklyEmail'
import { isPermissionDenied, loadBrigadeForAdmin, useAdminGate } from '../../state/adminGate'
import { addNavAppliance, loadNavAppliances } from '../../state/navAppliances'

interface Toast {
  text: string
  isError: boolean
}

const route = useRoute()
const router = useRouter()
const slug = route.params.slug as string

const gate = useAdminGate((profile) => loadBrigadeForAdmin(profile, slug), "Couldn't load this brigade.")

const appliances = ref<ApplianceSummary[]>([])
const hasDraft = ref(new Set<string>())
const draftsUnknown = ref(false)
const selectedApplianceId = ref<string | null>(null)

const months = recentMonths(today(), 12)
const selectedMonth = ref(months[1] ?? months[0])

const downloading = ref(false)
const preparingQr = ref(false)
const toast = ref<Toast | null>(null)

const brigadeSummary = computed(() => gate.data.value)
const home = computed(() => {
  const profile = gate.profile.value
  return profile?.kind === 'admin' && profile.role === 'brigadeAdmin' && profile.homeSlug === slug
})
const brigadeName = computed(() => brigadeSummary.value?.brigade.name ?? 'Brigade admin')
const frameBrigade = computed(() => (brigadeSummary.value ? { slug, name: brigadeName.value } : undefined))
const hasList = computed(() => gate.profile.value !== null && hasBrigadeList(gate.profile.value))
// A Brigade Admin has no brigade list to go up to; this page is their admin home.
const up = computed(() => (hasList.value ? { to: '/admin/brigades', label: '‹ Brigades' } : undefined))
const crumbs = computed(() => [
  ...(hasList.value ? [{ label: 'Brigades', to: '/admin/brigades' }] : []),
  { label: brigadeName.value },
])

const details = ref<BrigadeDraft | null>(null)
const reportSettings = ref<ReportSettingsDraft | null>(null)
const reportSettingsError = ref<string | null>(null)
// Bumped on each save so the form re-reads the normalised values.
const detailsVersion = ref(0)
const savingDetails = ref(false)
// Held back until the email settings settle, so a Save can't go before their fields arrive.
const emailsSettled = computed(() => reportSettings.value !== null || reportSettingsError.value !== null)
const activeMode = computed(() => (gate.profile.value?.kind === 'superadmin' ? 'editable' : 'readonly'))
const showSettings = computed(() => gate.profile.value !== null && canManageBrigadeSettings(gate.profile.value))
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

// Check entry refuses an inactive brigade or appliance, and has nothing to show without a Check Sheet.
function canRunChecks(appliance: ApplianceSummary): boolean {
  return (
    brigadeSummary.value?.brigade.active === true && appliance.active && appliance.currentCheckSheetVersion !== null
  )
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

function loadDetails(summary: BrigadeSummary): void {
  details.value = { name: summary.brigade.name, checkDay: summary.brigade.checkDay, active: summary.brigade.active }
}

async function loadReportSettings(): Promise<void> {
  try {
    // A Brigade Admin can't read the weekly settings, and the form hides them anyway.
    const [settings, monthlyReport] = await Promise.all([
      showSettings.value ? getBrigadeSettings(slug) : Promise.resolve<BrigadeSettings>({}),
      getMonthlyReportSettings(slug),
    ])
    reportSettings.value = {
      reportEmail: settings.reportEmail ?? '',
      weeklyEmail: wantsWeeklyEmail(settings),
      monthlyReportEnabled: monthlyReport.enabled === true,
      monthlyReportEmail: monthlyReport.email ?? '',
    }
  } catch (err) {
    console.error(err)
    reportSettingsError.value = "Couldn't load the email settings."
  }
}

async function saveDetails(fields: NormalisedBrigade, settings: NormalisedReportSettings | null): Promise<void> {
  const summary = brigadeSummary.value
  if (!summary) return
  savingDetails.value = true
  try {
    const canChangeActive = activeMode.value === 'editable'
    await updateBrigade(slug, fields, canChangeActive, settings && { settings, includeWeekly: showSettings.value })
    const active = canChangeActive ? fields.active : summary.brigade.active
    gate.data.value = { slug, brigade: { ...summary.brigade, name: fields.name, checkDay: fields.checkDay, active } }
    details.value = { ...fields, active }
    if (settings) {
      reportSettings.value = {
        ...settings,
        reportEmail: settings.reportEmail ?? '',
        monthlyReportEmail: settings.monthlyReportEmail ?? '',
      }
    }
    detailsVersion.value++
    showToast('Saved', false)
  } catch (err) {
    console.error(err)
    showToast(isPermissionDenied(err) ? 'Not authorised.' : "Couldn't save", true)
  } finally {
    savingDetails.value = false
  }
}

watch(
  () => gate.loading.value,
  async (loading) => {
    if (loading || !brigadeSummary.value) return
    loadDetails(brigadeSummary.value)
    void loadReportSettings()
    try {
      appliances.value = await loadNavAppliances(slug)
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
    const callsign = newCallsign.value.trim()
    await addAppliance(slug, newId.value, callsign)
    addNavAppliance(slug, { id: newId.value, callsign, active: true, currentCheckSheetVersion: null })
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

async function downloadQr(): Promise<void> {
  const summary = brigadeSummary.value
  if (!summary) return
  preparingQr.value = true
  try {
    const { downloadQrSheet } = await import('../../report/qrPdf')
    await downloadQrSheet(summary.brigade.name, `${window.location.origin}/${slug}`)
  } catch (err) {
    console.error(err)
    showToast("Couldn't make the QR code", true)
  } finally {
    preparingQr.value = false
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
    :title="brigadeName"
    :up="up"
    :home="home"
    :crumbs="crumbs"
    :brigade="frameBrigade"
    :loading="gate.loading.value"
    :not-authorised="gate.notAuthorised.value"
    :error="frameError"
  >
    <main class="admin-page">
      <div class="admin-stack">
        <section class="admin-panel">
          <h2 class="panel-title">
            Details
          </h2>
          <BrigadeDetailsForm
            v-if="details && emailsSettled"
            :key="detailsVersion"
            :initial="details"
            :active="activeMode"
            submit-label="Save"
            :saving="savingDetails"
            :report-settings="reportSettings ?? undefined"
            :report-settings-error="reportSettingsError ?? undefined"
            :show-weekly="showSettings"
            @save="saveDetails"
          />
        </section>

        <section class="admin-panel">
          <h2 class="panel-title">
            Appliances
          </h2>
          <div class="appliance-table">
            <div
              v-for="appliance in appliances"
              :key="appliance.id"
              :class="['appliance-row', appliance.active ? '' : 'inactive']"
            >
              <span class="appliance-row-callsign">{{ appliance.callsign }}</span>
              <span class="appliance-row-id">{{ appliance.id }}</span>
              <span class="appliance-row-active">{{ appliance.active ? 'Active' : 'Inactive' }}</span>
              <span class="appliance-row-status">{{ sheetStatus(appliance) }}</span>
              <span class="appliance-row-actions">
                <router-link
                  :to="`/${slug}/admin/${appliance.id}`"
                  class="small-btn fit-btn positive row-edit"
                >
                  Edit
                </router-link>
                <router-link
                  v-if="canRunChecks(appliance)"
                  :to="`/${slug}/${appliance.id}`"
                  class="small-btn fit-btn row-checks"
                  aria-label="Checks"
                  title="Checks"
                >
                  <AdminIcon
                    name="clipboard"
                    :size="18"
                  />
                </router-link>
                <button
                  v-else
                  type="button"
                  class="small-btn fit-btn row-checks"
                  aria-label="Checks"
                  title="Checks"
                  disabled
                >
                  <AdminIcon
                    name="clipboard"
                    :size="18"
                  />
                </button>
              </span>
            </div>

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
            class="small-btn fit-btn positive add-appliance"
            @click="startAdding"
          >
            + Add appliance
          </button>
        </section>

        <section class="admin-panel">
          <h2 class="panel-title">
            Tools
          </h2>
          <h3 class="block-title">
            Download a Monthly Report
          </h3>
          <div class="tool-row">
            <label class="tool-field appliance-field">
              <span class="picker-heading">Appliance</span>
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
            </label>
            <label class="tool-field">
              <span class="picker-heading">Month</span>
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
            </label>
            <button
              class="small-btn fit-btn positive download-btn"
              :disabled="!canDownload"
              @click="download"
            >
              {{ downloading ? 'Preparing…' : 'Download' }}
            </button>
          </div>
          <p
            v-if="noCheckSheet"
            class="error-msg no-check-sheet"
          >
            No Check Sheet yet.
          </p>

          <div class="qr-block">
            <div class="qr-text">
              <h3 class="block-title">
                QR code
              </h3>
              <p class="block-note">
                Print this and put it up where Checks start, e.g. the engine bay.
              </p>
            </div>
            <button
              class="small-btn fit-btn positive download-qr"
              :disabled="preparingQr || !brigadeSummary"
              @click="downloadQr"
            >
              {{ preparingQr ? 'Preparing…' : 'Download' }}
            </button>
          </div>
        </section>
      </div>
    </main>

    <div
      id="toast"
      :class="{ show: toast, error: toast?.isError }"
    >
      {{ toast?.text }}
    </div>
  </AdminFrame>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { type NormalisedReportSettings, normaliseReportSettings, type ReportSettingsDraft } from '../../domain/brigade'

// The weekly email is for VSOs and the superadmin; a Brigade Admin can't read its settings.
const props = defineProps<{
  initial: ReportSettingsDraft
  showWeekly: boolean
  saving: boolean
}>()

const emit = defineEmits<{ save: [settings: NormalisedReportSettings] }>()

const draft = reactive<ReportSettingsDraft>({ ...props.initial })
const problem = ref<string | null>(null)

function submit(): void {
  const result = normaliseReportSettings(draft)
  problem.value = result.ok ? null : result.problem
  if (result.ok) emit('save', result.settings)
}
</script>

<template>
  <form
    class="report-settings"
    @submit.prevent="submit"
  >
    <div class="report-block">
      <h3 class="block-title">
        Monthly Report email
      </h3>
      <p class="block-note">
        Every appliance's Monthly Report as a PDF, once the month's last Checks are done.
      </p>
      <label class="checkbox-row">
        <input
          v-model="draft.monthlyReportEnabled"
          type="checkbox"
          class="monthly-report-enabled"
        >
        Send it
      </label>
      <div class="picker-heading">
        To
      </div>
      <input
        v-model="draft.monthlyReportEmail"
        type="email"
        class="item-input monthly-report-email"
      >
    </div>

    <div
      v-if="props.showWeekly"
      class="report-block"
    >
      <h3 class="block-title">
        Weekly VSO email <span class="vso-tag">VSOs only</span>
      </h3>
      <p class="block-note">
        Each Check Day, how complete the previous Checks were, for following up.
      </p>
      <label class="checkbox-row">
        <input
          v-model="draft.weeklyEmail"
          type="checkbox"
          class="weekly-email"
        >
        Send it
      </label>
      <div class="picker-heading">
        To
      </div>
      <input
        v-model="draft.reportEmail"
        type="email"
        class="item-input report-email"
        placeholder="Blank: the brigade's VSOs"
      >
    </div>

    <p
      v-if="problem"
      class="error-msg"
    >
      {{ problem }}
    </p>

    <button
      type="submit"
      class="small-btn fit-btn positive save-reports"
      :disabled="props.saving"
    >
      Save email settings
    </button>
  </form>
</template>

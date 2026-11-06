<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  type BrigadeDraft,
  CHECK_DAYS,
  type NormalisedBrigade,
  type NormalisedReportSettings,
  normaliseBrigade,
  normaliseReportSettings,
  type ReportSettingsDraft,
} from '../../domain/brigade'
import ReportSettingsFields from './ReportSettingsFields.vue'

// `active` is 'hidden' on create (a new brigade is always active), and 'readonly' for anyone but
// the superadmin. Without `reportSettings` there are no email fields, and the save emits null for
// them, so settings that failed to load are never overwritten.
const props = defineProps<{
  initial: BrigadeDraft
  active: 'hidden' | 'editable' | 'readonly'
  submitLabel: string
  saving: boolean
  reportSettings?: ReportSettingsDraft
  reportSettingsError?: string
  showWeekly?: boolean
}>()

const emit = defineEmits<{ save: [brigade: NormalisedBrigade, reportSettings: NormalisedReportSettings | null] }>()

const draft = reactive<BrigadeDraft>({ ...props.initial })
const reportDraft = ref<ReportSettingsDraft | null>(props.reportSettings ? { ...props.reportSettings } : null)
const problem = ref<string | null>(null)

function submit(): void {
  const brigade = normaliseBrigade(draft)
  if (!brigade.ok) {
    problem.value = brigade.problem
    return
  }
  if (reportDraft.value === null) {
    problem.value = null
    emit('save', brigade.brigade, null)
    return
  }
  const reports = normaliseReportSettings(reportDraft.value)
  problem.value = reports.ok ? null : reports.problem
  if (reports.ok) emit('save', brigade.brigade, reports.settings)
}
</script>

<template>
  <form
    class="brigade-details"
    @submit.prevent="submit"
  >
    <div class="picker-heading">
      Name
    </div>
    <input
      v-model="draft.name"
      type="text"
      class="item-input brigade-name"
    >

    <div class="picker-heading">
      Check Day
    </div>
    <select
      v-model="draft.checkDay"
      class="item-select check-day-select"
    >
      <option :value="null">
        Pick a Check Day
      </option>
      <option
        v-for="day in CHECK_DAYS"
        :key="day.value"
        :value="day.value"
      >
        {{ day.label }}
      </option>
    </select>

    <template v-if="props.active !== 'hidden'">
      <div class="picker-heading">
        Status
      </div>
      <label
        v-if="props.active === 'editable'"
        class="checkbox-row"
      >
        <input
          v-model="draft.active"
          type="checkbox"
          class="brigade-active"
        >
        Brigade is active
      </label>
      <div
        v-else
        class="brigade-active-readonly"
      >
        {{ draft.active ? 'Active' : 'Inactive' }}
      </div>
    </template>

    <ReportSettingsFields
      v-if="reportDraft"
      v-model="reportDraft"
      :show-weekly="props.showWeekly === true"
    />
    <p
      v-else-if="props.reportSettingsError"
      class="error-msg"
    >
      {{ props.reportSettingsError }}
    </p>

    <p
      v-if="problem"
      class="error-msg"
    >
      {{ problem }}
    </p>

    <button
      type="submit"
      class="small-btn fit-btn positive save-brigade"
      :disabled="props.saving"
    >
      {{ props.submitLabel }}
    </button>
  </form>
</template>

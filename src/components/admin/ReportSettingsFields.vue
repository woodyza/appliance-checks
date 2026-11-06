<script setup lang="ts">
import type { ReportSettingsDraft } from '../../domain/brigade'

// The weekly email is for VSOs and the superadmin; a Brigade Admin can't read its settings.
const props = defineProps<{ showWeekly: boolean }>()

const draft = defineModel<ReportSettingsDraft>({ required: true })
</script>

<template>
  <div class="report-settings">
    <div class="report-block">
      <h3 class="block-title">
        Monthly Report email
      </h3>
      <p class="block-note">
        Every appliance's Monthly Report as a PDF, once the month's last Checks are done.
      </p>
      <div class="picker-heading">
        To
      </div>
      <div class="inline-row">
        <input
          v-model="draft.monthlyReportEmail"
          type="email"
          class="item-input monthly-report-email"
        >
        <label class="checkbox-row">
          <input
            v-model="draft.monthlyReportEnabled"
            type="checkbox"
            class="monthly-report-enabled"
          >
          Enabled
        </label>
      </div>
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
      <div class="picker-heading">
        To
      </div>
      <div class="inline-row">
        <input
          v-model="draft.reportEmail"
          type="email"
          class="item-input report-email"
          placeholder="Blank: the brigade's VSOs"
        >
        <label class="checkbox-row">
          <input
            v-model="draft.weeklyEmail"
            type="checkbox"
            class="weekly-email"
          >
          Enabled
        </label>
      </div>
    </div>
  </div>
</template>

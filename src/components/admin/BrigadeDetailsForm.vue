<script setup lang="ts">
import { reactive, ref } from 'vue'
import { type BrigadeDraft, CHECK_DAYS, type NormalisedBrigade, normaliseBrigade } from '../../domain/brigade'

// `active` is 'hidden' on create (a new brigade is always active), and 'readonly' for anyone but
// the superadmin.
const props = defineProps<{
  initial: BrigadeDraft
  active: 'hidden' | 'editable' | 'readonly'
  submitLabel: string
  saving: boolean
}>()

const emit = defineEmits<{ save: [brigade: NormalisedBrigade] }>()

const draft = reactive<BrigadeDraft>({ ...props.initial })
const problem = ref<string | null>(null)

function submit(): void {
  const result = normaliseBrigade(draft)
  problem.value = result.ok ? null : result.problem
  if (result.ok) emit('save', result.brigade)
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
        Active
      </label>
      <div
        v-else
        class="brigade-active-readonly"
      >
        {{ draft.active ? 'Active' : 'Inactive' }}
      </div>
    </template>

    <div class="picker-heading">
      Report Email
    </div>
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
      Send the weekly email
    </label>

    <p
      v-if="problem"
      class="error-msg"
    >
      {{ problem }}
    </p>

    <button
      type="submit"
      class="action-btn positive save-brigade"
      :disabled="props.saving"
    >
      {{ props.submitLabel }}
    </button>
  </form>
</template>

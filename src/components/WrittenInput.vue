<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ value: string; blocked: boolean }>()
const emit = defineEmits<{ commit: [value: string | null] }>()

// A bound `:value` gets re-applied on every re-render, so a re-read landing mid-edit would wipe
// what's been typed but not yet committed. Keep a local draft and only follow outside changes
// while the input isn't being edited.
const draft = ref(props.value)
let editing = false

watch(
  () => props.value,
  (value) => {
    if (!editing) draft.value = value
  },
)

function onFocus(): void {
  editing = true
}

function onChange(): void {
  const value = draft.value.trim()
  emit('commit', value === '' ? null : value)
}

function onBlur(): void {
  editing = false
  draft.value = props.value
}
</script>

<template>
  <input
    v-model="draft"
    type="text"
    maxlength="200"
    :class="['item-input', blocked ? 'saving' : '']"
    placeholder="Enter value…"
    @focus="onFocus"
    @change="onChange"
    @blur="onBlur"
  >
</template>

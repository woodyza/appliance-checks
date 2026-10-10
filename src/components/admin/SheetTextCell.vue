<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  value: string
  pending?: boolean
  invalid?: boolean
  placeholder?: string
  cell?: string
  maxlength?: number
}>()
const emit = defineEmits<{ commit: [value: string]; enter: [] }>()

// Keep what's typed until it's committed: a re-render from the committed draft mustn't wipe it.
// Once committed, follow `value`, so an edit that fails shows what's saved rather than being sent
// again on blur.
const text = ref(props.value)
let typed = false

watch(
  () => props.value,
  (value) => {
    if (!typed) text.value = value
  },
)

function commit(): void {
  if (!typed) return
  typed = false
  const trimmed = text.value.trim()
  if (trimmed !== props.value) emit('commit', trimmed)
}

function onInput(): void {
  typed = true
}

async function onBlur(): Promise<void> {
  commit()
  // A commit that doesn't land (refused, or invalid) leaves `value` as it was: show that.
  await nextTick()
  if (!typed) text.value = props.value
}

function onEnter(): void {
  commit()
  text.value = text.value.trim()
  emit('enter')
}
</script>

<template>
  <input
    v-model="text"
    type="text"
    :maxlength="maxlength"
    :data-cell="cell"
    :placeholder="placeholder"
    :class="['cell-input', pending ? 'saving' : '', invalid ? 'invalid' : '']"
    @input="onInput"
    @blur="onBlur"
    @keydown.enter.prevent="onEnter"
  >
</template>

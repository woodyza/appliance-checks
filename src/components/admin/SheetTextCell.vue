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

// Keep what's typed while focused: a re-render from the committed draft mustn't wipe it.
const text = ref(props.value)
let editing = false

watch(
  () => props.value,
  (value) => {
    if (!editing) text.value = value
  },
)

function commit(): void {
  const trimmed = text.value.trim()
  if (trimmed !== props.value) emit('commit', trimmed)
}

function onFocus(): void {
  editing = true
}

async function onBlur(): Promise<void> {
  editing = false
  commit()
  // A commit that doesn't land (refused, or invalid) leaves `value` as it was: show that.
  await nextTick()
  if (!editing) text.value = props.value
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
    @focus="onFocus"
    @blur="onBlur"
    @keydown.enter.prevent="onEnter"
  >
</template>

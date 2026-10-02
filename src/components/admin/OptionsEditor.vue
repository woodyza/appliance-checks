<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{ options: string[]; pending?: boolean; invalid?: boolean; cell?: string }>()
const emit = defineEmits<{ commit: [options: string[]] }>()

const joined = (options: string[]): string => options.join('\n')

const text = ref(joined(props.options))
let editing = false

watch(
  () => props.options,
  (options) => {
    if (!editing) text.value = joined(options)
  },
)

// Options aren't trimmed (an imported option is matched exactly by an answer); only blank lines
// left at the end are dropped.
function parse(value: string): string[] {
  const lines = value.split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function onFocus(): void {
  editing = true
}

async function onBlur(): Promise<void> {
  editing = false
  if (text.value !== joined(props.options)) emit('commit', parse(text.value))
  await nextTick()
  if (!editing) text.value = joined(props.options)
}
</script>

<template>
  <textarea
    v-model="text"
    rows="2"
    placeholder="One option per line"
    :data-cell="cell"
    :class="['cell-input', 'cell-options', pending ? 'saving' : '', invalid ? 'invalid' : '']"
    @focus="onFocus"
    @blur="onBlur"
  />
</template>

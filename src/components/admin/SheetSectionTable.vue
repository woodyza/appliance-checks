<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import type { DraggableEvent } from 'vue-draggable-plus'
import type { PublishProblems } from '../../domain/publishValidation'
import type { SheetDiff } from '../../domain/sheetDiff'
import { type DraftOp, type ItemFields, withFields } from '../../domain/sheetDraft'
import type { InputType, Item, Scope, Section } from '../../domain/types'
import OptionsEditor from './OptionsEditor.vue'
import SheetTextCell from './SheetTextCell.vue'

const props = defineProps<{
  section: Section
  diff: SheetDiff | null
  problems: PublishProblems | null
  isPending: (id: string) => boolean
  makeId: () => string
  local?: boolean
}>()

const emit = defineEmits<{
  op: [op: DraftOp]
  removeItem: [item: Item, index: number]
  removeSection: []
  commitTitle: [title: string]
  dropLocal: []
}>()

const INPUT_LABELS: Record<InputType, string> = { yn: 'Y/N', choice: 'Choice', written: 'Written' }

const root = useTemplateRef<HTMLElement>('root')
const localRows = ref<Item[]>([])
const menuOpen = ref(false)

const rows = computed<Item[]>(() => {
  const real = new Set(props.section.items.map((item) => item.id))
  return [...props.section.items, ...localRows.value.filter((item) => !real.has(item.id))]
})

const isLocalRow = (id: string): boolean => localRows.value.some((item) => item.id === id)

function focusCell(cell: string): void {
  void nextTick(() => {
    root.value?.querySelector<HTMLElement>(`[data-cell="${cell}"]`)?.focus()
  })
}

function itemMarks(id: string): Record<string, boolean> {
  return {
    'row-added': props.diff?.items.added.has(id) ?? false,
    'row-changed': (props.diff?.items.changed.has(id) || props.diff?.items.renamed.has(id)) ?? false,
    'row-moved': props.diff?.items.moved.has(id) ?? false,
    'row-problem': props.problems?.itemIds.has(id) ?? false,
  }
}

const sectionMarks = computed(() => ({
  'row-added': props.diff?.sections.added.has(props.section.id) ?? false,
  'row-changed': props.diff?.sections.renamed.has(props.section.id) ?? false,
  'row-moved': props.diff?.sections.moved.has(props.section.id) ?? false,
}))

function addLocalRow(): void {
  if (localRows.value.length > 0) {
    focusCell(`label-${localRows.value[0].id}`)
    return
  }
  const item: Item = { id: props.makeId(), label: '', qty: null, inputType: 'yn', scope: 'weekly' }
  localRows.value.push(item)
  focusCell(`label-${item.id}`)
}

function setField(item: Item, fields: Partial<ItemFields>): void {
  if (isLocalRow(item.id)) {
    localRows.value = localRows.value.filter((row) => row.id !== item.id)
    emit('op', { type: 'addItem', sectionId: props.section.id, index: props.section.items.length, item: withFields(item, fields) })
    return
  }
  emit('op', { type: 'setItem', itemId: item.id, fields })
}

function setQty(item: Item, value: string): void {
  setField(item, { qty: value === '' ? null : value })
}

function setType(item: Item, event: Event): void {
  setField(item, { inputType: (event.target as HTMLSelectElement).value as InputType })
}

function setScope(item: Item, scope: Scope): void {
  if (item.scope !== scope) setField(item, { scope })
}

// A new row's Enter commits it first, and the parent hasn't re-rendered yet, so that row is in
// neither `section.items` nor `localRows`: it's still the last row.
function onEnter(item: Item): void {
  const justCommitted = !rows.value.some((row) => row.id === item.id)
  if (justCommitted || rows.value.at(-1)?.id === item.id) addLocalRow()
}

function onRowFocusOut(event: FocusEvent, item: Item): void {
  const row = event.currentTarget as HTMLElement
  if (row.contains(event.relatedTarget as Node | null)) return
  const untouched = item.label === '' && item.qty === null && item.inputType === 'yn' && item.scope === 'weekly'
  if (isLocalRow(item.id) && untouched) localRows.value = localRows.value.filter((row2) => row2.id !== item.id)
}

function onTitleFocusOut(event: FocusEvent): void {
  if (props.local && props.section.title === '' && !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
    emit('dropLocal')
  }
}

function moveBy(item: Item, delta: -1 | 1, event: KeyboardEvent): void {
  const index = props.section.items.findIndex((row) => row.id === item.id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= props.section.items.length) return
  const cell = (event.target as HTMLElement).dataset.cell
  emit('op', { type: 'moveItem', itemId: item.id, toSectionId: props.section.id, index: target })
  if (cell) focusCell(cell)
}

function onDragEnd(event: DraggableEvent): void {
  const itemId = event.item.dataset.itemId
  const toSectionId = (event.to as HTMLElement).dataset.sectionId
  if (!itemId || !toSectionId) return
  if (event.from === event.to && event.oldIndex === event.newIndex) return
  emit('op', { type: 'moveItem', itemId, toSectionId, index: event.newDraggableIndex ?? 0 })
}

function onTitle(title: string): void {
  if (props.local) emit('commitTitle', title)
  else emit('op', { type: 'renameSection', sectionId: props.section.id, title })
}

function onDeleteSection(): void {
  menuOpen.value = false
  if (props.section.items.length > 0 && !window.confirm(`Delete "${props.section.title}" and its ${String(props.section.items.length)} Items?`)) return
  emit('removeSection')
}
</script>

<template>
  <section
    :id="`section-${section.id}`"
    ref="root"
    :class="['sheet-section', sectionMarks]"
    :data-section-title="section.title"
  >
    <header
      class="sheet-section-header"
      @focusout="onTitleFocusOut"
    >
      <SheetTextCell
        class="section-title-input"
        :value="section.title"
        :pending="isPending(section.id)"
        :invalid="problems?.sectionIds.has(section.id)"
        :cell="`title-${section.id}`"
        placeholder="Section title"
        @commit="onTitle"
      />
      <div
        v-if="!local"
        class="menu"
      >
        <button
          class="menu-btn"
          aria-label="Section menu"
          @click="menuOpen = !menuOpen"
        >
          ⋯
        </button>
        <div
          v-if="menuOpen"
          class="menu-pop"
        >
          <button
            class="menu-item delete-section"
            @click="onDeleteSection"
          >
            Delete Section
          </button>
        </div>
      </div>
    </header>

    <div
      v-if="!local"
      class="sheet-head"
    >
      <span />
      <span>Label</span>
      <span>Qty</span>
      <span>Type</span>
      <span>Options</span>
      <span>Scope</span>
      <span />
    </div>

    <VueDraggable
      v-if="!local"
      :model-value="rows"
      group="items"
      handle=".drag-handle"
      :animation="150"
      class="sheet-rows"
      :data-section-id="section.id"
      @end="onDragEnd"
    >
      <div
        v-for="(item, index) in rows"
        :key="item.id"
        :data-item-id="item.id"
        :data-label="item.label"
        :class="['sheet-row', itemMarks(item.id)]"
        @focusout="onRowFocusOut($event, item)"
        @keydown.alt.up.prevent="moveBy(item, -1, $event)"
        @keydown.alt.down.prevent="moveBy(item, 1, $event)"
      >
        <span :class="['drag-handle', isLocalRow(item.id) ? 'disabled' : '']">⠿</span>
        <SheetTextCell
          :value="item.label"
          :pending="isPending(item.id)"
          :invalid="problems?.itemIds.has(item.id) && item.label.trim() === ''"
          :cell="`label-${item.id}`"
          placeholder="Label"
          @commit="(value) => setField(item, { label: value })"
          @enter="onEnter(item)"
        />
        <SheetTextCell
          :value="item.qty ?? ''"
          :pending="isPending(item.id)"
          :cell="`qty-${item.id}`"
          @commit="(value) => setQty(item, value)"
          @enter="onEnter(item)"
        />
        <select
          :value="item.inputType"
          :class="['cell-input', 'cell-type', isPending(item.id) ? 'saving' : '']"
          @change="setType(item, $event)"
        >
          <option
            v-for="(label, type) in INPUT_LABELS"
            :key="type"
            :value="type"
          >
            {{ label }}
          </option>
        </select>
        <OptionsEditor
          v-if="item.inputType === 'choice'"
          :options="item.options ?? []"
          :pending="isPending(item.id)"
          :invalid="problems?.itemIds.has(item.id)"
          :cell="`options-${item.id}`"
          @commit="(options) => setField(item, { options })"
        />
        <span v-else />
        <div class="scope-toggle">
          <button
            :class="{ active: item.scope === 'weekly' }"
            @click="setScope(item, 'weekly')"
          >
            Weekly
          </button>
          <button
            :class="{ active: item.scope === 'monthly' }"
            @click="setScope(item, 'monthly')"
          >
            Monthly
          </button>
        </div>
        <button
          class="row-delete"
          aria-label="Delete Item"
          :disabled="isLocalRow(item.id)"
          @click="emit('removeItem', item, index)"
        >
          ✕
        </button>
      </div>
    </VueDraggable>

    <button
      v-if="!local"
      class="add-item"
      @click="addLocalRow"
    >
      + Item
    </button>
  </section>
</template>

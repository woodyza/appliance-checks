<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import type { DraggableEvent } from 'vue-draggable-plus'
import { useRoute } from 'vue-router'
import AdminFrame from '../../components/AdminFrame.vue'
import SheetSectionTable from '../../components/admin/SheetSectionTable.vue'
import SheetTextCell from '../../components/admin/SheetTextCell.vue'
import { listAllAppliances, updateAppliance } from '../../data/checkSheet'
import { type ApplianceSummary, getVersion } from '../../data/checks'
import { callsignProblem } from '../../domain/appliance'
import { parseSpreadsheetId, importPrefill } from '../../domain/import/source'
import { summary } from '../../domain/sheetDiff'
import { allIds, type DraftOp, uniqueId } from '../../domain/sheetDraft'
import type { Item, Section } from '../../domain/types'
import { isPermissionDenied, listBrigadesFor, loadBrigadeForAdmin, NOT_AUTHORISED, useAdminGate } from '../../state/adminGate'
import { useSheetEditor } from '../../state/sheetEditor'

const route = useRoute()
const slug = route.params.slug as string
const applianceId = route.params.applianceId as string

const gate = useAdminGate(async (profile) => {
  const loaded = await loadBrigadeForAdmin(profile, slug)
  if (loaded === NOT_AUTHORISED || loaded === null) return loaded
  return { ...loaded, copyBrigades: await listBrigadesFor(profile) }
}, "Couldn't load this brigade.")
const editor = useSheetEditor(slug, applianceId)

const brigadeSummary = computed(() => gate.data.value)
const invalidLink = computed(
  () => !gate.loading.value && !gate.notAuthorised.value && !gate.error.value && !brigadeSummary.value,
)
const frameError = computed(
  () => gate.error.value ?? (invalidLink.value ? "This link isn't valid." : editor.error.value),
)
const frameLoading = computed(() => gate.loading.value || (brigadeSummary.value !== null && editor.loading.value))

watch(
  () => gate.loading.value,
  (loading) => {
    if (!loading && brigadeSummary.value) void editor.load()
  },
  { immediate: true },
)

const callsign = computed(() => editor.appliance.value?.callsign ?? 'Appliance')
const callsignMessage = ref<string | null>(null)
const removedExpanded = ref(false)

const bannerSummary = computed(() => (editor.diff.value ? summary(editor.diff.value.counts) : ''))
const hasRemoved = computed(() => {
  const diff = editor.diff.value
  return diff !== null && (diff.items.removed.length > 0 || diff.sections.removed.length > 0)
})

function makeId(): string {
  return uniqueId(allIds(editor.sections.value))
}

function run(op: DraftOp): void {
  void editor.run(op)
}

async function commitCallsign(value: string): Promise<void> {
  callsignMessage.value = callsignProblem(value)
  if (callsignMessage.value || !editor.appliance.value) return
  try {
    await updateAppliance(slug, applianceId, { callsign: value })
    editor.appliance.value = { ...editor.appliance.value, callsign: value }
  } catch (err) {
    console.error(err)
    editor.showToast("Couldn't save", true)
  }
}

const activeSaving = ref(false)

async function onActiveChange(event: Event): Promise<void> {
  const box = event.target as HTMLInputElement
  const appliance = editor.appliance.value
  if (!appliance) return
  const active = box.checked
  if (
    !active &&
    !window.confirm(`${appliance.callsign} will drop off the Brigade Link. Deactivate it?`)
  ) {
    box.checked = true
    return
  }
  activeSaving.value = true
  try {
    await updateAppliance(slug, applianceId, { active })
    editor.appliance.value = { ...appliance, active }
  } catch (err) {
    console.error(err)
    box.checked = !active
    editor.showToast(isPermissionDenied(err) ? 'Not authorised.' : "Couldn't save", true)
  } finally {
    activeSaving.value = false
  }
}

function onRemoveItem(section: Section, item: Item, index: number): void {
  const removed = { ...item }
  run({ type: 'removeItem', itemId: item.id })
  editor.showToast(`Deleted "${item.label}"`, false, {
    label: 'Undo',
    run: () => run({ type: 'addItem', sectionId: section.id, index, item: removed }),
  })
}

function onRemoveSection(section: Section): void {
  run({ type: 'removeSection', sectionId: section.id })
}

function onSectionDragEnd(event: DraggableEvent): void {
  const sectionId = event.item.dataset.sectionId
  if (!sectionId || event.oldIndex === event.newIndex) return
  run({ type: 'moveSection', sectionId, index: event.newDraggableIndex ?? 0 })
}

function scrollToSection(id: string): void {
  document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const localSection = ref<Section | null>(null)

function addLocalSection(): void {
  if (!localSection.value) localSection.value = { id: makeId(), title: '', items: [] }
  const id = localSection.value.id
  void nextTick(() => {
    const title = document.querySelector<HTMLElement>(`[data-cell="title-${id}"]`)
    title?.scrollIntoView({ block: 'center' })
    title?.focus()
  })
}

function commitLocalSection(title: string): void {
  const section = localSection.value
  if (!section) return
  localSection.value = null
  run({ type: 'addSection', index: editor.sections.value.length, section: { ...section, title } })
}

async function publish(): Promise<void> {
  await editor.publish()
}

async function discard(): Promise<void> {
  if (window.confirm('Discard these unpublished changes?')) await editor.discard()
}

const panel = ref<'copy' | 'import' | null>(null)
const panelError = ref<string | null>(null)

function togglePanel(which: 'copy' | 'import'): void {
  panelError.value = null
  panel.value = panel.value === which ? null : which
  if (panel.value === 'copy') void loadCopySources()
  if (panel.value === 'import') {
    importInput.value = importPrefill(editor.draft.value?.origin ?? null, editor.current.value?.origin ?? null)
  }
}

const copyBrigade = ref(slug)
const copySources = ref<ApplianceSummary[]>([])
const copyApplianceId = ref('')
watch(copyBrigade, () => void loadCopySources())

async function loadCopySources(): Promise<void> {
  copyApplianceId.value = ''
  copySources.value = []
  try {
    const all = await listAllAppliances(copyBrigade.value)
    copySources.value = all.filter(
      (appliance) =>
        appliance.currentCheckSheetVersion !== null && !(copyBrigade.value === slug && appliance.id === applianceId),
    )
  } catch (err) {
    console.error(err)
    panelError.value = "Couldn't load appliances."
  }
}

async function copyFromSource(): Promise<void> {
  const source = copySources.value.find((appliance) => appliance.id === copyApplianceId.value)
  if (!source || source.currentCheckSheetVersion === null) return
  if (editor.hasDraft.value && !window.confirm('Replace your unpublished changes with this Check Sheet?')) return
  panelError.value = null
  try {
    const version = await getVersion(copyBrigade.value, source.id, source.currentCheckSheetVersion)
    if (await editor.copyFrom(version.sections)) panel.value = null
  } catch (err) {
    console.error(err)
    panelError.value = "Couldn't load that Check Sheet."
  }
}

const importInput = ref('')

async function importFromSheet(): Promise<void> {
  const spreadsheetId = parseSpreadsheetId(importInput.value)
  if (!spreadsheetId) {
    panelError.value = 'Paste a Google Sheet link or id.'
    return
  }
  if (editor.hasDraft.value && !window.confirm('Replace your unpublished changes with this spreadsheet?')) return
  panelError.value = await editor.importSheet(spreadsheetId)
  if (!panelError.value) panel.value = null
}
</script>

<template>
  <AdminFrame
    :title="callsign"
    :up="{ to: `/${slug}/admin`, label: '‹ Brigade admin' }"
    :loading="frameLoading"
    :not-authorised="gate.notAuthorised.value"
    :error="frameError"
  >
    <main class="admin-page">
      <div class="details-row">
        <label class="field">
          <span class="field-label">Callsign</span>
          <SheetTextCell
            class="callsign-input"
            :value="callsign"
            :maxlength="80"
            @commit="commitCallsign"
          />
        </label>
        <label class="field field-toggle">
          <span class="field-label">Active</span>
          <input
            type="checkbox"
            class="active-toggle"
            :checked="editor.appliance.value?.active"
            :disabled="activeSaving"
            @change="onActiveChange"
          >
        </label>
      </div>
      <p
        v-if="callsignMessage"
        class="field-error callsign-error"
      >
        {{ callsignMessage }}
      </p>

      <div
        v-if="editor.hasDraft.value"
        :class="['review-banner', editor.problems.value || editor.replaced.value ? 'has-problems' : '']"
      >
        <div class="banner-main">
          <span class="banner-text">
            Unpublished changes<template v-if="bannerSummary">:
              <span class="banner-summary">{{ bannerSummary }}</span></template>
          </span>
          <button
            v-if="hasRemoved"
            class="small-btn banner-toggle"
            @click="removedExpanded = !removedExpanded"
          >
            {{ removedExpanded ? 'Hide removed' : 'Show removed' }}
          </button>
          <span class="banner-actions">
            <button
              class="small-btn discard-btn"
              :disabled="editor.busy.value"
              @click="discard"
            >
              Discard
            </button>
            <button
              class="small-btn primary publish-btn"
              :disabled="editor.busy.value || editor.replaced.value"
              @click="publish"
            >
              Publish
            </button>
          </span>
        </div>
        <ul
          v-if="editor.problems.value"
          class="banner-problems"
        >
          <li
            v-for="message in editor.problems.value.messages"
            :key="message"
          >
            {{ message }}
          </li>
        </ul>
        <p
          v-if="editor.replaced.value"
          class="banner-replaced"
        >
          The Check Sheet was replaced since these edits started. Discard them to carry on.
        </p>
        <ul
          v-if="removedExpanded && editor.diff.value"
          class="banner-removed"
        >
          <li
            v-for="removed in editor.diff.value.sections.removed"
            :key="removed.id"
          >
            Section "{{ removed.title }}"
          </li>
          <li
            v-for="removed in editor.diff.value.items.removed"
            :key="removed.item.id"
          >
            "{{ removed.item.label }}" ({{ removed.sectionTitle }})
          </li>
        </ul>
      </div>

      <div class="editor-layout">
        <aside class="editor-sidebar">
          <div class="side-heading">
            Sections
          </div>
          <VueDraggable
            :model-value="editor.sections.value"
            handle=".drag-handle"
            :animation="150"
            class="side-sections"
            @end="onSectionDragEnd"
          >
            <div
              v-for="section in editor.sections.value"
              :key="section.id"
              class="side-section"
              :data-section-id="section.id"
            >
              <span class="drag-handle">⠿</span>
              <button
                class="side-link"
                @click="scrollToSection(section.id)"
              >
                {{ section.title || 'Untitled' }}
              </button>
              <span class="side-count">{{ section.items.length }}</span>
            </div>
          </VueDraggable>
          <button
            class="side-btn add-section"
            @click="addLocalSection"
          >
            + Section
          </button>

          <button
            class="side-btn copy-open"
            @click="togglePanel('copy')"
          >
            Copy from another appliance…
          </button>
          <div
            v-if="panel === 'copy'"
            class="side-panel copy-panel"
          >
            <select
              v-model="copyBrigade"
              class="item-select copy-brigade"
            >
              <option
                v-for="entry in gate.data.value?.copyBrigades ?? []"
                :key="entry.slug"
                :value="entry.slug"
              >
                {{ entry.brigade.name }}
              </option>
            </select>
            <select
              v-model="copyApplianceId"
              class="item-select copy-appliance"
            >
              <option value="">
                Choose an appliance
              </option>
              <option
                v-for="appliance in copySources"
                :key="appliance.id"
                :value="appliance.id"
              >
                {{ appliance.callsign }}
              </option>
            </select>
            <button
              class="small-btn primary copy-btn"
              :disabled="!copyApplianceId || editor.busy.value"
              @click="copyFromSource"
            >
              Copy
            </button>
            <p
              v-if="panelError"
              class="field-error panel-error"
            >
              {{ panelError }}
            </p>
          </div>

          <button
            class="side-btn import-open"
            @click="togglePanel('import')"
          >
            Import from Google Sheet…
          </button>
          <div
            v-if="panel === 'import'"
            class="side-panel import-panel"
          >
            <input
              v-model="importInput"
              type="text"
              class="cell-input import-input"
              placeholder="Google Sheet link or id"
              @keydown.enter.prevent="importFromSheet"
            >
            <button
              class="small-btn primary import-btn"
              :disabled="editor.busy.value"
              @click="importFromSheet"
            >
              {{ editor.busy.value ? 'Importing…' : 'Import' }}
            </button>
            <p
              v-if="panelError"
              class="field-error panel-error"
            >
              {{ panelError }}
            </p>
          </div>
        </aside>

        <div class="editor-main">
          <SheetSectionTable
            v-for="section in editor.sections.value"
            :key="section.id"
            :section="section"
            :diff="editor.diff.value"
            :problems="editor.problems.value"
            :is-pending="editor.isPending"
            :make-id="makeId"
            @op="run"
            @remove-item="(item, index) => onRemoveItem(section, item, index)"
            @remove-section="onRemoveSection(section)"
          />
          <SheetSectionTable
            v-if="localSection"
            :key="localSection.id"
            :section="localSection"
            :diff="null"
            :problems="null"
            :is-pending="editor.isPending"
            :make-id="makeId"
            local
            @commit-title="commitLocalSection"
            @drop-local="localSection = null"
          />
          <p
            v-if="editor.sections.value.length === 0 && !localSection"
            class="empty-sheet"
          >
            No Check Sheet yet. Add a Section, copy one from another appliance, or import a Google Sheet.
          </p>
        </div>
      </div>
    </main>

    <div
      id="toast"
      :class="{ show: editor.toast.value, error: editor.toast.value?.isError, 'has-action': editor.toast.value?.action }"
    >
      {{ editor.toast.value?.text }}
      <button
        v-if="editor.toast.value?.action"
        class="toast-action"
        @click="editor.toast.value.action.run()"
      >
        {{ editor.toast.value.action.label }}
      </button>
    </div>
  </AdminFrame>
</template>

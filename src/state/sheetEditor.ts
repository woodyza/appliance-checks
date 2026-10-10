import { computed, type ComputedRef, reactive, ref, type Ref } from 'vue'
import {
  discardDraft,
  EditRefused,
  editDraft,
  getDraft,
  PublishInvalid,
  publishDraft,
  SheetReplaced,
  StaleEditor,
} from '../data/checkSheet'
import { getAppliance, getVersion } from '../data/checks'
import { deepEqual } from '../domain/deepEqual'
import { ImportError } from '../domain/import/errors'
import { fetchSheet } from '../domain/import/fetch'
import { copyEdit, importEdit } from '../domain/import/intoDraft'
import { parseCheckSheet } from '../domain/import/parse'
import { type PublishProblems, validateForPublish } from '../domain/publishValidation'
import { diffSheets, type SheetDiff } from '../domain/sheetDiff'
import { type DraftEdit, type DraftOp, editOp, type LoadedState } from '../domain/sheetDraft'
import type { Appliance, CheckSheetDraft, CheckSheetVersion, Section } from '../domain/types'

const SAVE_FAILURE_MESSAGE = "Couldn't save"
const RELOAD_MESSAGE = 'The Check Sheet changed: reloading'
const RELOAD_DELAY_MS = 1500
const TOAST_DURATION_MS = 4000
const ACTION_TOAST_DURATION_MS = 8000

export interface Toast {
  text: string
  isError: boolean
  action?: { label: string; run: () => void }
}

export interface SheetEditor {
  loading: Ref<boolean>
  error: Ref<string | null>
  appliance: Ref<Appliance | null>
  current: Ref<CheckSheetVersion | null>
  draft: Ref<CheckSheetDraft | null>
  sections: Ref<Section[]>
  hasDraft: ComputedRef<boolean>
  diff: ComputedRef<SheetDiff | null>
  problems: Ref<PublishProblems | null>
  replaced: Ref<boolean>
  busy: Ref<boolean>
  toast: Ref<Toast | null>
  isPending: (id: string) => boolean
  load: (silent?: boolean) => Promise<void>
  run: (op: DraftOp) => Promise<boolean>
  publish: () => Promise<void>
  discard: () => Promise<void>
  copyFrom: (sections: Section[]) => Promise<boolean>
  importSheet: (spreadsheetId: string) => Promise<string | null>
  showToast: (text: string, isError: boolean, action?: Toast['action']) => void
}

function opIds(op: DraftOp): string[] {
  switch (op.type) {
    case 'setItem':
    case 'removeItem':
    case 'moveItem':
      return [op.itemId]
    case 'addItem':
      return [op.item.id]
    case 'addSection':
      return [op.section.id]
    case 'renameSection':
    case 'removeSection':
    case 'moveSection':
      return [op.sectionId]
  }
}

export function useSheetEditor(slug: string, applianceId: string): SheetEditor {
  const loading = ref(true)
  const error = ref<string | null>(null)
  const appliance = ref<Appliance | null>(null)
  const current = ref<CheckSheetVersion | null>(null)
  const base = ref<CheckSheetVersion | null>(null)
  const draft = ref<CheckSheetDraft | null>(null)
  const sections = ref<Section[]>([])
  const problems = ref<PublishProblems | null>(null)
  const replaced = ref(false)
  const busy = ref(false)
  const toast = ref<Toast | null>(null)
  const pending = reactive(new Map<string, number>())
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  let loaded: LoadedState = { draftExists: false, baseVersion: null }
  let queue: Promise<unknown> = Promise.resolve()
  let queued = 0
  let stale = false

  const hasDraft = computed(() => draft.value !== null || !deepEqual(sections.value, base.value?.sections ?? []))

  const diff = computed<SheetDiff | null>(() =>
    hasDraft.value ? diffSheets(base.value?.sections ?? [], sections.value) : null,
  )

  function showToast(text: string, isError: boolean, action?: Toast['action']): void {
    clearTimeout(toastTimer)
    toast.value = {
      text,
      isError,
      action: action && {
        label: action.label,
        run: () => {
          clearTimeout(toastTimer)
          toast.value = null
          action.run()
        },
      },
    }
    toastTimer = setTimeout(() => {
      toast.value = null
    }, action ? ACTION_TOAST_DURATION_MS : TOAST_DURATION_MS)
  }

  function isPending(id: string): boolean {
    return (pending.get(id) ?? 0) > 0
  }

  function markPending(ids: string[], delta: 1 | -1): void {
    for (const id of ids) {
      const next = (pending.get(id) ?? 0) + delta
      if (next <= 0) pending.delete(id)
      else pending.set(id, next)
    }
  }

  function committedSections(): Section[] {
    return draft.value?.sections ?? base.value?.sections ?? []
  }

  function refreshProblems(): void {
    if (!problems.value) return
    const fresh = validateForPublish(committedSections())
    problems.value = fresh.messages.length > 0 ? fresh : null
  }

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = queue.then(job)
    queue = result.catch(() => undefined)
    return result
  }

  function reloadPage(): void {
    if (stale) return
    stale = true
    showToast(RELOAD_MESSAGE, true)
    setTimeout(() => {
      window.location.reload()
    }, RELOAD_DELAY_MS)
  }

  async function load(silent = false): Promise<void> {
    if (!silent) loading.value = true
    error.value = null
    try {
      const applianceDoc = await getAppliance(slug, applianceId)
      if (!applianceDoc) {
        error.value = "This link isn't valid."
        return
      }
      const draftDoc = await getDraft(slug, applianceId)
      const pointer = applianceDoc.currentCheckSheetVersion
      const baseNumber = draftDoc ? draftDoc.baseVersion : pointer

      current.value = pointer === null ? null : await getVersion(slug, applianceId, pointer)
      base.value = baseNumber === null ? null : await getVersion(slug, applianceId, baseNumber)
      appliance.value = applianceDoc
      draft.value = draftDoc
      loaded = { draftExists: draftDoc !== null, baseVersion: baseNumber }
      sections.value = committedSections()
      problems.value = null
      replaced.value = false
    } catch (err) {
      console.error(err)
      error.value = "Couldn't load this appliance."
    } finally {
      loading.value = false
    }
  }

  async function execute(edit: DraftEdit): Promise<boolean> {
    if (stale) return false
    try {
      const committed = await editDraft(slug, applianceId, loaded, base.value, edit)
      draft.value = committed
      loaded = { ...loaded, draftExists: committed !== null }
      refreshProblems()
      return true
    } catch (err) {
      if (err instanceof StaleEditor) {
        reloadPage()
        return false
      }
      if (err instanceof EditRefused) {
        draft.value = err.draft
        loaded = { ...loaded, draftExists: err.draft !== null }
      } else {
        console.error(err)
      }
      showToast(SAVE_FAILURE_MESSAGE, true)
      return false
    }
  }

  // Queued so a fast typist's edits reach Firestore one at a time. `sections` shows the edit at
  // once; once the queue drains it's replaced by whatever was actually committed, which also
  // picks up other admins' edits and reverts anything that failed.
  function runEdit(edit: DraftEdit, ids: string[] = [], optimistic = true): Promise<boolean> {
    queued++
    markPending(ids, 1)
    if (optimistic) {
      const next = edit.apply(sections.value)
      if (next) sections.value = next
    }
    return enqueue(() => execute(edit)).finally(() => {
      queued--
      markPending(ids, -1)
      if (queued === 0) sections.value = committedSections()
    })
  }

  function run(op: DraftOp): Promise<boolean> {
    return runEdit(editOp(op), opIds(op))
  }

  async function publish(): Promise<void> {
    if (busy.value) return
    busy.value = true
    await enqueue(async () => {
      try {
        if (stale) return
        await publishDraft(slug, applianceId, loaded)
        await load(true)
        showToast('Published', false)
      } catch (err) {
        if (err instanceof StaleEditor) {
          reloadPage()
        } else if (err instanceof SheetReplaced) {
          replaced.value = true
        } else if (err instanceof PublishInvalid) {
          problems.value = err.problems
          draft.value = err.draft
          sections.value = err.draft.sections
        } else {
          console.error(err)
          showToast("Couldn't publish", true)
        }
      } finally {
        busy.value = false
      }
    })
  }

  async function discard(): Promise<void> {
    if (busy.value) return
    busy.value = true
    await enqueue(async () => {
      try {
        if (stale) return
        await discardDraft(slug, applianceId, loaded)
        await load(true)
        showToast('Discarded', false)
      } catch (err) {
        if (err instanceof StaleEditor) {
          reloadPage()
        } else {
          console.error(err)
          showToast("Couldn't discard", true)
        }
      } finally {
        busy.value = false
      }
    })
  }

  async function runBusy(edit: DraftEdit): Promise<boolean> {
    busy.value = true
    try {
      return await runEdit(edit, [], false)
    } finally {
      busy.value = false
    }
  }

  function copyFrom(source: Section[]): Promise<boolean> {
    return runBusy(copyEdit(source))
  }

  async function importSheet(spreadsheetId: string): Promise<string | null> {
    try {
      const grid = await fetchSheet(spreadsheetId, import.meta.env.VITE_SHEETS_API_KEY ?? '')
      const parsed = parseCheckSheet(grid)
      return (await runBusy(importEdit(parsed, spreadsheetId))) ? null : SAVE_FAILURE_MESSAGE
    } catch (err) {
      if (!(err instanceof ImportError)) console.error(err)
      return err instanceof Error ? err.message : String(err)
    }
  }

  return {
    loading,
    error,
    appliance,
    current,
    draft,
    sections,
    hasDraft,
    diff,
    problems,
    replaced,
    busy,
    toast,
    isPending,
    load,
    run,
    publish,
    discard,
    copyFrom,
    importSheet,
    showToast,
  }
}

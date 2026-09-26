import { computed, type ComputedRef, type InjectionKey, onMounted, onUnmounted, reactive, ref, type Ref, watch } from 'vue'
import {
  checkId,
  getAppliance,
  getBrigade,
  getCachedVersion,
  getCheck,
  getVersion,
  listRecentChecks,
  optInToLatest,
  writeResponse,
} from '../data/checks'
import {
  defaultCheckDate,
  isComplete,
  isFrozen,
  isStarted,
  mergeResponses,
  monthlyFor,
  previousValue,
  renderVersion,
  sectionProgress,
  type SectionProgress,
  selectorDates,
} from '../domain/check'
import { currentCheckDate, firstOfPreviousMonth, today } from '../domain/schedule'
import type { Appliance, Brigade, Check, Section } from '../domain/types'

const SAVE_FAILURE_MESSAGE = "Couldn't save. If this keeps happening, this device can't save right now."
const REFRESH_FAILURE_MESSAGE = "Couldn't refresh this Check. If this keeps happening, this device can't load data right now."
const TOAST_DURATION_MS = 4000

export interface Toast {
  text: string
  isError: boolean
}

export interface CheckSession {
  loading: Ref<boolean>
  error: Ref<string | null>
  brigade: Ref<Brigade | null>
  appliance: Ref<Appliance | null>
  currentDate: ComputedRef<string>
  defaultDate: ComputedRef<string>
  selectorDates: ComputedRef<string[]>
  selectedDate: ComputedRef<string>
  monthly: ComputedRef<boolean>
  frozen: ComputedRef<boolean>
  ready: ComputedRef<boolean>
  everReady: ComputedRef<boolean>
  renderedVersion: ComputedRef<number | null>
  renderedSections: Ref<Section[]>
  responses: ComputedRef<Record<string, string>>
  progress: ComputedRef<SectionProgress[]>
  complete: ComputedRef<boolean>
  canOptIn: ComputedRef<boolean>
  isPending: (itemId: string) => boolean
  toast: Ref<Toast | null>
  select: (date: string) => void
  refresh: (date?: string) => Promise<void>
  answer: (itemId: string, value: string | null) => Promise<void>
  optIn: () => Promise<void>
  previousValueFor: (itemId: string) => string | null
  showToast: (text: string, isError: boolean) => void
}

export const CHECK_SESSION_KEY: InjectionKey<CheckSession> = Symbol('checkSession')

export function useCheckSession(slug: string, applianceId: string, selected: Ref<string | null>): CheckSession {
  const loading = ref(true)
  const error = ref<string | null>(null)
  const brigade = ref<Brigade | null>(null)
  const appliance = ref<Appliance | null>(null)
  const recentChecks = ref<Check[]>([])
  const previousComplete = ref(false)
  const currentVersionSections = ref<Section[]>([])
  const stampedSections = ref<Section[]>([])
  const stampedForVersion = ref<number | null>(null)
  const localOverrides = reactive(new Map<string, Record<string, string>>())
  const pendingByDate = reactive(new Map<string, Set<string>>())
  const toast = ref<Toast | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  // Reactive "today", so a tab left open across a Check Day (or midnight) picks up the new
  // current Check, default and selector once it's looked at again, rather than staying stuck on
  // whatever "today" was when the session first loaded.
  const todayRef = ref(today())
  function refreshToday(): void {
    if (document.visibilityState === 'visible') todayRef.value = today()
  }
  onMounted(() => {
    document.addEventListener('visibilitychange', refreshToday)
  })
  onUnmounted(() => {
    document.removeEventListener('visibilitychange', refreshToday)
  })

  const currentDate = computed<string>(() => {
    return brigade.value ? currentCheckDate(todayRef.value, brigade.value.checkDay) : todayRef.value
  })

  function latestPrevious(checks: Check[], before: string): Check | null {
    return (
      checks
        .filter((check) => check.scheduledDate < before)
        .sort((a, b) => (a.scheduledDate < b.scheduledDate ? 1 : -1))[0] ?? null
    )
  }

  const defaultDate = computed<string>(() => {
    if (!brigade.value) return currentDate.value
    const previous = latestPrevious(recentChecks.value, currentDate.value)
    const existing = recentChecks.value.map((check) => ({
      scheduledDate: check.scheduledDate,
      started: isStarted(check),
      complete: previous !== null && check.scheduledDate === previous.scheduledDate ? previousComplete.value : false,
    }))
    return defaultCheckDate(existing, currentDate.value, todayRef.value, brigade.value.checkDay)
  })

  const selectorDatesList = computed<string[]>(() => {
    if (!brigade.value) return [currentDate.value]
    return selectorDates(
      recentChecks.value.map((check) => check.scheduledDate),
      defaultDate.value,
      currentDate.value,
      todayRef.value,
      brigade.value.checkDay,
    )
  })

  const selectedDate = computed<string>(() => {
    if (selected.value && selectorDatesList.value.includes(selected.value)) return selected.value
    return defaultDate.value
  })

  const existingCheck = computed<Check | null>(
    () => recentChecks.value.find((check) => check.scheduledDate === selectedDate.value) ?? null,
  )

  const monthly = computed<boolean>(() => monthlyFor(existingCheck.value, selectedDate.value))

  const ready = computed<boolean>(() => {
    return !existingCheck.value || stampedForVersion.value === existingCheck.value.checkSheetVersion
  })

  // Once the session has been ready for some selection, later re-gating (switching to a Check
  // whose stamped version isn't cached yet, or a version bump just after a write) must not swap
  // the already-rendered view out for the loading screen again: `ready` still blocks writes, but
  // the UI keeps showing what it has.
  const everReady = ref(false)
  watch(
    ready,
    (value) => {
      if (value) everReady.value = true
    },
    { immediate: true },
  )

  const frozen = computed<boolean>(() => {
    if (!existingCheck.value || !brigade.value) return false
    if (stampedForVersion.value !== existingCheck.value.checkSheetVersion) return false
    return isFrozen(
      existingCheck.value,
      { version: existingCheck.value.checkSheetVersion, createdAt: new Date(), origin: { type: 'editor' }, sections: stampedSections.value },
      todayRef.value,
      brigade.value.checkDay,
    )
  })

  const renderedVersion = computed<number | null>(() => {
    if (!appliance.value?.currentCheckSheetVersion) return null
    return renderVersion(existingCheck.value, frozen.value, appliance.value.currentCheckSheetVersion)
  })

  const renderedSections = computed<Section[]>(() => (frozen.value ? stampedSections.value : currentVersionSections.value))

  function pendingSetFor(date: string): Set<string> {
    return pendingByDate.get(date) ?? new Set()
  }

  function markPending(date: string, itemId: string): void {
    const next = new Set(pendingByDate.get(date) ?? [])
    next.add(itemId)
    pendingByDate.set(date, next)
  }

  function clearPending(date: string, itemId: string): void {
    const next = new Set(pendingByDate.get(date) ?? [])
    next.delete(itemId)
    if (next.size === 0) pendingByDate.delete(date)
    else pendingByDate.set(date, next)
  }

  function isPending(itemId: string): boolean {
    return pendingSetFor(selectedDate.value).has(itemId)
  }

  const responses = computed<Record<string, string>>(() => {
    const local = localOverrides.get(selectedDate.value) ?? {}
    return mergeResponses(local, existingCheck.value?.responses ?? {}, pendingSetFor(selectedDate.value))
  })

  const progress = computed<SectionProgress[]>(() => sectionProgress(renderedSections.value, responses.value, monthly.value))

  const complete = computed<boolean>(() => isComplete(renderedSections.value, responses.value, monthly.value))

  const canOptIn = computed<boolean>(() => {
    if (!frozen.value || !appliance.value?.currentCheckSheetVersion || renderedVersion.value === null) return false
    return renderedVersion.value < appliance.value.currentCheckSheetVersion
  })

  watch(
    existingCheck,
    (check) => {
      if (!check) {
        stampedSections.value = []
        stampedForVersion.value = null
        return
      }

      // Cached versions (the current version, and any already loaded this session) resolve
      // synchronously: no need to await, and so no render where `ready` is transiently false and
      // the main content briefly swaps out for the loading screen.
      const cached = getCachedVersion(slug, applianceId, check.checkSheetVersion)
      if (cached) {
        stampedSections.value = cached.sections
        stampedForVersion.value = check.checkSheetVersion
        return
      }

      // The selected Check can change again while this fetch is in flight (e.g. a fast selector
      // change, or another re-read landing first): a stale resolution must not clobber whatever
      // is current by the time it lands.
      const isStale = (): boolean => {
        const current = existingCheck.value
        return !current || current.scheduledDate !== check.scheduledDate || current.checkSheetVersion !== check.checkSheetVersion
      }
      void (async () => {
        try {
          const version = await getVersion(slug, applianceId, check.checkSheetVersion)
          if (isStale()) return
          stampedSections.value = version.sections
          stampedForVersion.value = check.checkSheetVersion
        } catch {
          if (isStale()) return
          stampedSections.value = []
          stampedForVersion.value = null
          error.value = 'Could not load the Check Sheet for this Check.'
        }
      })()
    },
    { immediate: true },
  )

  function showToast(text: string, isError: boolean): void {
    clearTimeout(toastTimer)
    toast.value = { text, isError }
    toastTimer = setTimeout(() => {
      toast.value = null
    }, TOAST_DURATION_MS)
  }

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const brigadeDoc = await getBrigade(slug)
      if (!brigadeDoc || !brigadeDoc.active) {
        error.value = "This link isn't valid."
        return
      }
      brigade.value = brigadeDoc

      const applianceDoc = await getAppliance(slug, applianceId)
      if (!applianceDoc || !applianceDoc.active) {
        error.value = 'not-found'
        appliance.value = null
        return
      }
      appliance.value = applianceDoc

      if (applianceDoc.currentCheckSheetVersion === null) {
        error.value = 'No Check Sheet yet.'
        return
      }

      const since = firstOfPreviousMonth(todayRef.value)
      const checks = await listRecentChecks(slug, applianceId, since)
      recentChecks.value = checks

      const cur = currentCheckDate(todayRef.value, brigadeDoc.checkDay)
      const previous = latestPrevious(checks, cur)
      if (previous) {
        const stamped = await getVersion(slug, applianceId, previous.checkSheetVersion)
        previousComplete.value = isComplete(stamped.sections, previous.responses, previous.monthly)
      } else {
        previousComplete.value = false
      }

      currentVersionSections.value = (await getVersion(slug, applianceId, applianceDoc.currentCheckSheetVersion)).sections
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not load this Check.'
    } finally {
      loading.value = false
    }
  }

  async function refresh(date: string = selectedDate.value): Promise<void> {
    const id = checkId(applianceId, date)
    const fresh = await getCheck(slug, id)
    if (!fresh) return
    // Only treat a higher stamped version as reason to reload the whole session when it's for
    // the Check currently being viewed: a write for a Check the user has since navigated away
    // from shouldn't yank them back with a full reload.
    if (date === selectedDate.value && renderedVersion.value !== null && fresh.checkSheetVersion > renderedVersion.value) {
      await load()
      return
    }
    const idx = recentChecks.value.findIndex((check) => check.scheduledDate === fresh.scheduledDate)
    if (idx >= 0) recentChecks.value.splice(idx, 1, fresh)
    else recentChecks.value = [...recentChecks.value, fresh]
  }

  function select(date: string): void {
    selected.value = date
  }

  async function answer(itemId: string, value: string | null): Promise<void> {
    // Until the stamped version for the selected Check is known, we can't tell whether it's
    // Frozen, so we don't know which version a write should stamp. Writing here could silently
    // move a Frozen Check onto the latest Check Sheet (ADR 0002 says that must never happen
    // automatically).
    if (!ready.value) return

    const dateKey = selectedDate.value

    const local = { ...(localOverrides.get(dateKey) ?? {}) }
    if (value === null) delete local[itemId]
    else local[itemId] = value
    localOverrides.set(dateKey, local)
    markPending(dateKey, itemId)

    const fields = {
      applianceId,
      scheduledDate: dateKey,
      monthly: monthly.value,
      checkSheetVersion: renderedVersion.value ?? 1,
    }

    try {
      await writeResponse(slug, fields, itemId, value)
      await refresh(dateKey)
    } catch {
      try {
        // Re-read and take the server's value for this Item (also reloading the session if the
        // re-read shows a higher checkSheetVersion). If the re-read itself fails, leave the
        // cached Check as-is; the toast below tells the user their change may not have saved.
        await refresh(dateKey)
      } catch {
        /* leave the cached Check as-is */
      }
      showToast(SAVE_FAILURE_MESSAGE, true)
    } finally {
      clearPending(dateKey, itemId)
    }
  }

  async function optIn(): Promise<void> {
    if (!ready.value) return
    if (!appliance.value?.currentCheckSheetVersion) return
    const fields = {
      applianceId,
      scheduledDate: selectedDate.value,
      monthly: monthly.value,
      checkSheetVersion: appliance.value.currentCheckSheetVersion,
    }
    try {
      await optInToLatest(slug, fields)
      await refresh(selectedDate.value)
    } catch {
      showToast(SAVE_FAILURE_MESSAGE, true)
    }
  }

  function previousValueFor(itemId: string): string | null {
    return previousValue(itemId, selectedDate.value, recentChecks.value)
  }

  void load()

  return {
    loading,
    error,
    brigade,
    appliance,
    currentDate,
    defaultDate,
    selectorDates: selectorDatesList,
    selectedDate,
    monthly,
    frozen,
    ready,
    everReady: computed(() => everReady.value),
    renderedVersion,
    renderedSections,
    responses,
    progress,
    complete,
    canOptIn,
    isPending,
    toast,
    select,
    refresh,
    answer,
    optIn,
    previousValueFor,
    showToast,
  }
}

export { REFRESH_FAILURE_MESSAGE }

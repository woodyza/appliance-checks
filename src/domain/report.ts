import { answerFits, isDue, isFrozen, monthlyFor, renderVersion, sectionProgress } from './check'
import { addDays, checkDatesBetween, currentCheckDate, firstOfNextMonth } from './schedule'
import type { Appliance, Brigade, Check, CheckSheetVersion, Item } from './types'

export type ReportCell =
  | { kind: 'na' }
  | { kind: 'notDue' }
  | { kind: 'yn'; value: 'Y' | 'N' | null }
  | { kind: 'value'; value: string | null }

export interface ReportColumn {
  date: string
  check: Check | null
  version: number
  monthly: boolean
  percent: number
}

export interface ReportRow {
  item: Item
  cells: ReportCell[]
}

export interface ReportSection {
  id: string
  title: string
  rows: ReportRow[]
}

export interface MonthlyReport {
  brigadeName: string
  callsign: string
  month: string
  columns: ReportColumn[]
  sections: ReportSection[]
}

export interface BuildMonthlyReportArgs {
  brigade: Brigade
  appliance: Appliance
  month: string
  checks: Check[]
  versions: Map<number, CheckSheetVersion>
  currentVersion: CheckSheetVersion
  today: string
}

interface WorkingSection {
  id: string
  title: string
  items: Item[]
}

function findItem(version: CheckSheetVersion, itemId: string): Item | undefined {
  for (const section of version.sections) {
    const item = section.items.find((candidate) => candidate.id === itemId)
    if (item) return item
  }
  return undefined
}

function cellFor(itemId: string, version: CheckSheetVersion, monthly: boolean, responses: Record<string, string>): ReportCell {
  const item = findItem(version, itemId)
  if (!item) return { kind: 'na' }
  if (!isDue(item, monthly)) return { kind: 'notDue' }

  const raw = responses[itemId]
  const fitting = answerFits(item, raw) ? raw : null
  if (item.inputType === 'yn') {
    return { kind: 'yn', value: fitting as 'Y' | 'N' | null }
  }
  return { kind: 'value', value: fitting }
}

// Inserts `target` into `merged` right after the nearest of its preceding siblings (per
// `orderedInVersion`) that's already placed, or first if none of them are.
function insertAfterPredecessor<T extends { id: string }>(target: T, orderedInVersion: T[], merged: T[]): void {
  const positionInVersion = orderedInVersion.findIndex((entry) => entry.id === target.id)
  let insertAt = 0
  for (let i = positionInVersion - 1; i >= 0; i--) {
    const mergedIndex = merged.findIndex((entry) => entry.id === orderedInVersion[i].id)
    if (mergedIndex !== -1) {
      insertAt = mergedIndex + 1
      break
    }
  }
  merged.splice(insertAt, 0, target)
}

function toWorking(version: CheckSheetVersion): WorkingSection[] {
  return version.sections.map((section) => ({ id: section.id, title: section.title, items: [...section.items] }))
}

function mergeSections(base: CheckSheetVersion, olderVersions: CheckSheetVersion[]): WorkingSection[] {
  const merged = toWorking(base)
  // Matched by id across Sections, so an Item moved between Sections keeps its newest placement.
  const placedItems = new Set(merged.flatMap((section) => section.items.map((item) => item.id)))

  for (const version of olderVersions) {
    for (const section of version.sections) {
      let mergedSection = merged.find((candidate) => candidate.id === section.id)
      if (!mergedSection) {
        mergedSection = { id: section.id, title: section.title, items: [] }
        insertAfterPredecessor(mergedSection, version.sections, merged)
      }

      for (const item of section.items) {
        if (!placedItems.has(item.id)) {
          insertAfterPredecessor(item, section.items, mergedSection.items)
          placedItems.add(item.id)
        }
      }
    }
  }

  return merged
}

export function buildMonthlyReport(args: BuildMonthlyReportArgs): MonthlyReport {
  const { brigade, appliance, month, checks, versions, currentVersion, today } = args

  function resolveVersion(versionNumber: number): CheckSheetVersion {
    if (versionNumber === currentVersion.version) return currentVersion
    const version = versions.get(versionNumber)
    if (!version) throw new Error(`Missing CheckSheetVersion ${versionNumber}`)
    return version
  }

  const start = `${month}-01`
  const lastOfMonth = addDays(firstOfNextMonth(start), -1)
  const currentDate = currentCheckDate(today, brigade.checkDay)
  const windowEnd = currentDate < lastOfMonth ? currentDate : lastOfMonth
  const computedDates = checkDatesBetween(start, windowEnd, brigade.checkDay)
  const dates = [...new Set([...computedDates, ...checks.map((check) => check.scheduledDate)])].sort()

  const checkByDate = new Map(checks.map((check) => [check.scheduledDate, check]))
  const existingVersionNumbers: number[] = []

  const resolvedDates = dates.map((date) => {
    const check = checkByDate.get(date) ?? null
    if (!check) return { date, check: null as Check | null, versionNumber: null as number | null }

    const stamped = resolveVersion(check.checkSheetVersion)
    const frozen = isFrozen(check, stamped, today, brigade.checkDay)
    const versionNumber = renderVersion(check, frozen, currentVersion.version)
    existingVersionNumbers.push(versionNumber)
    return { date, check, versionNumber }
  })

  const baseVersionNumber = existingVersionNumbers.length > 0 ? Math.max(...existingVersionNumbers) : currentVersion.version

  const columns: ReportColumn[] = resolvedDates.map(({ date, check, versionNumber }) => {
    const resolvedNumber = versionNumber ?? baseVersionNumber
    const version = resolveVersion(resolvedNumber)
    const monthly = monthlyFor(check, date)
    const responses = check?.responses ?? {}

    const progress = sectionProgress(version.sections, responses, monthly)
    const due = progress.reduce((sum, section) => sum + section.due.length, 0)
    const answered = progress.reduce((sum, section) => sum + section.answered, 0)
    const percent = due > 0 ? Math.floor((answered / due) * 100) : 0

    return { date, check, version: resolvedNumber, monthly, percent }
  })

  const olderVersionNumbers = [...new Set(existingVersionNumbers)]
    .filter((versionNumber) => versionNumber < baseVersionNumber)
    .sort((a, b) => b - a)

  const mergedSections = mergeSections(resolveVersion(baseVersionNumber), olderVersionNumbers.map(resolveVersion))

  // A Section left empty once its Items moved elsewhere has nothing to show.
  const sections: ReportSection[] = mergedSections.filter((section) => section.items.length > 0).map((section) => ({
    id: section.id,
    title: section.title,
    rows: section.items.map((item) => ({
      item,
      cells: columns.map((column) => cellFor(item.id, resolveVersion(column.version), column.monthly, column.check?.responses ?? {})),
    })),
  }))

  return { brigadeName: brigade.name, callsign: appliance.callsign, month, columns, sections }
}

import { checkDatesBetween, firstOfMonth, isLastOfMonth, nextCheckDate } from './schedule'
import type { Check, CheckSheetVersion, Item, Section } from './types'

export function isDue(item: Item, monthly: boolean): boolean {
  return item.scope === 'weekly' || (item.scope === 'monthly' && monthly)
}

export interface SectionProgress {
  section: Section
  due: Item[]
  answered: number
}

export function sectionProgress(
  sections: Section[],
  responses: Record<string, string>,
  monthly: boolean,
): SectionProgress[] {
  return sections
    .map((section) => {
      const due = section.items.filter((item) => isDue(item, monthly))
      const answered = due.filter((item) => responses[item.id] !== undefined).length
      return { section, due, answered }
    })
    .filter((progress) => progress.due.length > 0)
}

export function isComplete(sections: Section[], responses: Record<string, string>, monthly: boolean): boolean {
  return sections.every((section) =>
    section.items.every((item) => !isDue(item, monthly) || responses[item.id] !== undefined),
  )
}

export function isStarted(check: Check): boolean {
  return Object.keys(check.responses).length > 0
}

export function isFrozen(check: Check, stamped: CheckSheetVersion, today: string, checkDay: number): boolean {
  return (
    isComplete(stamped.sections, check.responses, check.monthly) ||
    today >= nextCheckDate(check.scheduledDate, checkDay)
  )
}

export function renderVersion(check: Check | null, frozen: boolean, currentVersion: number): number {
  return check && frozen ? check.checkSheetVersion : currentVersion
}

export function monthlyFor(check: Check | null, date: string): boolean {
  return check ? check.monthly : isLastOfMonth(date)
}

export interface ExistingCheckSummary {
  scheduledDate: string
  started: boolean
  complete: boolean
}

export function defaultCheckDate(
  existing: ExistingCheckSummary[],
  currentDate: string,
  today: string,
  checkDay: number,
): string {
  const stillInWindow = existing
    .filter((check) => check.scheduledDate > currentDate && check.scheduledDate <= today)
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? 1 : -1))[0]
  if (stillInWindow) return stillInWindow.scheduledDate

  if (existing.some((check) => check.scheduledDate === currentDate)) return currentDate

  const previous = existing
    .filter((check) => check.scheduledDate < currentDate)
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? 1 : -1))[0]

  if (
    previous &&
    previous.started &&
    !previous.complete &&
    nextCheckDate(previous.scheduledDate, checkDay) === currentDate
  ) {
    return previous.scheduledDate
  }

  return currentDate
}

export function selectorDates(
  existingDates: string[],
  defaultDate: string,
  currentDate: string,
  today: string,
  checkDay: number,
): string[] {
  const from = firstOfMonth(defaultDate)
  const computed = checkDatesBetween(from, currentDate, checkDay)
  const existingInRange = existingDates.filter((date) => date >= from && date <= today)
  return [...new Set([...computed, ...existingInRange])].sort()
}

export function previousValue(itemId: string, selectedDate: string, checks: Check[]): string | null {
  const earlier = checks
    .filter((check) => check.scheduledDate < selectedDate)
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? 1 : -1))

  for (const check of earlier) {
    const value = check.responses[itemId]
    if (value !== undefined && value !== '') return value
  }
  return null
}

export function mergeResponses(
  local: Record<string, string>,
  fresh: Record<string, string>,
  pending: ReadonlySet<string>,
): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [itemId, value] of Object.entries(fresh)) {
    if (!pending.has(itemId)) merged[itemId] = value
  }
  for (const itemId of pending) {
    if (Object.prototype.hasOwnProperty.call(local, itemId)) merged[itemId] = local[itemId]
  }
  return merged
}

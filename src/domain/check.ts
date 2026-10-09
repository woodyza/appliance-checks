import { addDays, checkDatesBetween, firstOfMonth, isLastOfMonth, nextCheckDate } from './schedule'
import type { Check, CheckSheetVersion, Item, Section } from './types'

export function isDue(item: Item, monthly: boolean): boolean {
  return item.scope === 'weekly' || (item.scope === 'monthly' && monthly)
}

export function answerFits(item: Item, value: string | undefined): boolean {
  if (value === undefined) return false
  switch (item.inputType) {
    case 'yn':
      return value === 'Y' || value === 'N'
    case 'choice':
      return (item.options ?? []).includes(value)
    case 'written':
      return value !== ''
  }
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
      const answered = due.filter((item) => answerFits(item, responses[item.id])).length
      return { section, due, answered }
    })
    .filter((progress) => progress.due.length > 0)
}

export function checkPercent(sections: Section[], responses: Record<string, string>, monthly: boolean): number {
  const progress = sectionProgress(sections, responses, monthly)
  const due = progress.reduce((sum, section) => sum + section.due.length, 0)
  const answered = progress.reduce((sum, section) => sum + section.answered, 0)
  return due > 0 ? Math.floor((answered / due) * 100) : 0
}

export function isComplete(sections: Section[], responses: Record<string, string>, monthly: boolean): boolean {
  return sections.every((section) =>
    section.items.every((item) => !isDue(item, monthly) || answerFits(item, responses[item.id])),
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

export function isCompleteAsRendered(
  check: Check,
  stamped: CheckSheetVersion,
  current: CheckSheetVersion,
  today: string,
  checkDay: number,
): boolean {
  const sections = isFrozen(check, stamped, today, checkDay) ? stamped.sections : current.sections
  return isComplete(sections, check.responses, check.monthly)
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

/**
 * On an early day (`upcoming` set), the upcoming Check only becomes the default once the Check
 * that would otherwise be the default is Complete, so an unfinished Check is hard to miss.
 */
export function defaultCheckDate(
  existing: ExistingCheckSummary[],
  currentDate: string,
  today: string,
  checkDay: number,
  upcoming: string | null,
): string {
  const date = inWindowDefault(existing, currentDate, today, checkDay)
  if (upcoming && existing.some((check) => check.scheduledDate === date && check.complete)) return upcoming
  return date
}

function inWindowDefault(
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
  upcoming: string | null,
): string[] {
  // The previous Check stays reachable after the current one is started, so it can still be
  // finished late when it falls in the month before.
  const previousDate = addDays(currentDate, -7)
  const from = firstOfMonth(defaultDate < previousDate ? defaultDate : previousDate)
  const computed = checkDatesBetween(from, upcoming ?? currentDate, checkDay)
  const existingInRange = existingDates.filter((date) => date >= from && date <= (upcoming ?? today))
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

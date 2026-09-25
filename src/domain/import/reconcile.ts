import { newId } from '../slug'
import type { Item, ParsedCheckSheet, ParsedItem, Section } from '../types'
import { normalise } from './normalise'

export interface ImportReportItem {
  section: string
  label: string
}

export interface ImportReportChangedItem extends ImportReportItem {
  fields: string[]
}

export interface SectionRename {
  from: string
  to: string
}

export interface ImportReport {
  matched: ImportReportItem[]
  changed: ImportReportChangedItem[]
  added: ImportReportItem[]
  removed: ImportReportItem[]
  sectionsAdded: string[]
  sectionsRemoved: string[]
  sectionsRenamed: SectionRename[]
  reordered: boolean
}

export interface ReconcileResult {
  sections: Section[]
  report: ImportReport
  unchanged: boolean
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  }
  return false
}

const ITEM_FIELDS: (keyof ParsedItem)[] = ['label', 'qty', 'inputType', 'options', 'scope']

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i])
}

function toItem(id: string, parsed: ParsedItem): Item {
  return parsed.options === undefined
    ? { id, label: parsed.label, qty: parsed.qty, inputType: parsed.inputType, scope: parsed.scope }
    : {
        id,
        label: parsed.label,
        qty: parsed.qty,
        inputType: parsed.inputType,
        options: parsed.options,
        scope: parsed.scope,
      }
}

function reconcileItems(
  currentItems: Item[],
  parsedItems: ParsedItem[],
  sectionTitle: string,
  makeId: () => string,
  report: ImportReport,
): Item[] {
  const currentByKey = new Map(currentItems.map((item) => [normalise(item.label), item]))
  const parsedKeys = new Set(parsedItems.map((item) => normalise(item.label)))

  const result: Item[] = parsedItems.map((parsedItem) => {
    const key = normalise(parsedItem.label)
    const existing = currentByKey.get(key)

    if (!existing) {
      report.added.push({ section: sectionTitle, label: parsedItem.label })
      return toItem(makeId(), parsedItem)
    }

    const changedFields = ITEM_FIELDS.filter((field) => !deepEqual(existing[field], parsedItem[field]))
    if (changedFields.length > 0) {
      report.changed.push({ section: sectionTitle, label: parsedItem.label, fields: changedFields })
    } else {
      report.matched.push({ section: sectionTitle, label: parsedItem.label })
    }
    return toItem(existing.id, parsedItem)
  })

  for (const currentItem of currentItems) {
    if (!parsedKeys.has(normalise(currentItem.label))) {
      report.removed.push({ section: sectionTitle, label: currentItem.label })
    }
  }

  const currentMatchedOrder = currentItems.map((item) => normalise(item.label)).filter((key) => parsedKeys.has(key))
  const parsedMatchedOrder = parsedItems.map((item) => normalise(item.label)).filter((key) => currentByKey.has(key))
  if (!sameOrder(currentMatchedOrder, parsedMatchedOrder)) {
    report.reordered = true
  }

  return result
}

export function reconcile(
  current: Section[] | null,
  parsed: ParsedCheckSheet,
  makeId: () => string = newId,
): ReconcileResult {
  const report: ImportReport = {
    matched: [],
    changed: [],
    added: [],
    removed: [],
    sectionsAdded: [],
    sectionsRemoved: [],
    sectionsRenamed: [],
    reordered: false,
  }

  const currentByKey = new Map((current ?? []).map((section) => [normalise(section.title), section]))
  const parsedKeys = new Set(parsed.sections.map((section) => normalise(section.title)))

  const sections: Section[] = parsed.sections.map((parsedSection) => {
    const key = normalise(parsedSection.title)
    const existing = currentByKey.get(key)

    if (!existing) {
      report.sectionsAdded.push(parsedSection.title)
      const sectionId = makeId()
      const items = parsedSection.items.map((item) => {
        report.added.push({ section: parsedSection.title, label: item.label })
        return toItem(makeId(), item)
      })
      return { id: sectionId, title: parsedSection.title, items }
    }

    if (existing.title !== parsedSection.title) {
      report.sectionsRenamed.push({ from: existing.title, to: parsedSection.title })
    }

    const items = reconcileItems(existing.items, parsedSection.items, parsedSection.title, makeId, report)
    return { id: existing.id, title: parsedSection.title, items }
  })

  for (const section of current ?? []) {
    if (!parsedKeys.has(normalise(section.title))) {
      report.sectionsRemoved.push(section.title)
      for (const item of section.items) {
        report.removed.push({ section: section.title, label: item.label })
      }
    }
  }

  const currentMatchedSectionOrder = (current ?? [])
    .map((section) => normalise(section.title))
    .filter((key) => parsedKeys.has(key))
  const parsedMatchedSectionOrder = parsed.sections
    .map((section) => normalise(section.title))
    .filter((key) => currentByKey.has(key))
  if (!sameOrder(currentMatchedSectionOrder, parsedMatchedSectionOrder)) {
    report.reordered = true
  }

  const unchanged = current !== null && deepEqual(sections, current)

  return { sections, report, unchanged }
}

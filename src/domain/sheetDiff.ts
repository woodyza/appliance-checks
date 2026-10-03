import { deepEqual } from './deepEqual'
import type { Item, Section } from './types'

export interface DiffCounts {
  added: number
  removed: number
  renamed: number
  changed: number
  moved: number
}

export interface SheetDiff {
  items: {
    added: Set<string>
    removed: { item: Item; sectionTitle: string }[]
    renamed: Set<string>
    changed: Set<string>
    moved: Set<string>
  }
  sections: { added: Set<string>; removed: Section[]; renamed: Set<string>; moved: Set<string> }
  counts: DiffCounts
}

function lcs(a: string[], b: string[]): Set<string> {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const kept = new Set<string>()
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      kept.add(a[i])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return kept
}

function movedAmongShared(baseIds: string[], draftIds: string[]): string[] {
  const draftSet = new Set(draftIds)
  const baseSet = new Set(baseIds)
  const sharedBase = baseIds.filter((id) => draftSet.has(id))
  const sharedDraft = draftIds.filter((id) => baseSet.has(id))
  const kept = lcs(sharedBase, sharedDraft)
  return sharedDraft.filter((id) => !kept.has(id))
}

function itemsChanged(before: Item, after: Item): boolean {
  return (
    before.qty !== after.qty ||
    before.inputType !== after.inputType ||
    before.scope !== after.scope ||
    !deepEqual(before.options, after.options)
  )
}

export function diffSheets(base: Section[], draft: Section[]): SheetDiff {
  const baseItems = new Map(
    base.flatMap((section) => section.items.map((item) => [item.id, { item, section }] as const)),
  )
  const draftItems = new Map(
    draft.flatMap((section) => section.items.map((item) => [item.id, { item, section }] as const)),
  )
  const baseSections = new Map(base.map((section) => [section.id, section]))
  const draftSectionIds = new Set(draft.map((section) => section.id))

  const items: SheetDiff['items'] = {
    added: new Set(),
    removed: [],
    renamed: new Set(),
    changed: new Set(),
    moved: new Set(),
  }

  for (const [id, { item, section }] of draftItems) {
    const before = baseItems.get(id)
    if (!before) {
      items.added.add(id)
      continue
    }
    if (before.item.label !== item.label) items.renamed.add(id)
    if (itemsChanged(before.item, item)) items.changed.add(id)
    if (before.section.id !== section.id) items.moved.add(id)
  }

  for (const [id, { item, section }] of baseItems) {
    if (!draftItems.has(id)) items.removed.push({ item, sectionTitle: section.title })
  }

  for (const section of draft) {
    const before = baseSections.get(section.id)
    if (!before) continue
    const stayed = (id: string): boolean => baseItems.get(id)?.section.id === section.id
    const baseIds = before.items.map((item) => item.id).filter((id) => draftItems.get(id)?.section.id === section.id)
    const draftIds = section.items.map((item) => item.id).filter(stayed)
    for (const id of movedAmongShared(baseIds, draftIds)) items.moved.add(id)
  }

  const sections: SheetDiff['sections'] = {
    added: new Set(draft.filter((section) => !baseSections.has(section.id)).map((section) => section.id)),
    removed: base.filter((section) => !draftSectionIds.has(section.id)),
    renamed: new Set(
      draft.filter((section) => baseSections.get(section.id)?.title !== section.title && baseSections.has(section.id)).map((section) => section.id),
    ),
    moved: new Set(
      movedAmongShared(
        base.map((section) => section.id),
        draft.map((section) => section.id),
      ),
    ),
  }

  const counts: DiffCounts = {
    added: items.added.size + sections.added.size,
    removed: items.removed.length + sections.removed.length,
    renamed: items.renamed.size + sections.renamed.size,
    changed: items.changed.size,
    moved: items.moved.size + sections.moved.size,
  }

  return { items, sections, counts }
}

const SUMMARY_ORDER: (keyof DiffCounts)[] = ['added', 'removed', 'renamed', 'changed', 'moved']

export function summary(counts: DiffCounts): string {
  return SUMMARY_ORDER.filter((key) => counts[key] > 0)
    .map((key) => `${counts[key]} ${key}`)
    .join(' · ')
}

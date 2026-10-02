import { deepEqual } from './deepEqual'
import { type PublishProblems, validateForPublish } from './publishValidation'
import { newId } from './slug'
import type { CheckSheetDraft, CheckSheetOrigin, CheckSheetVersion, Item, Section } from './types'

export type ItemFields = Omit<Item, 'id'>

export type DraftOp =
  | { type: 'setItem'; itemId: string; fields: Partial<ItemFields> }
  | { type: 'addItem'; sectionId: string; index: number; item: Item }
  | { type: 'removeItem'; itemId: string }
  | { type: 'moveItem'; itemId: string; toSectionId: string; index: number }
  | { type: 'addSection'; index: number; section: Section }
  | { type: 'renameSection'; sectionId: string; title: string }
  | { type: 'removeSection'; sectionId: string }
  | { type: 'moveSection'; sectionId: string; index: number }

export function allIds(sections: Section[]): Set<string> {
  const ids = new Set<string>()
  for (const section of sections) {
    ids.add(section.id)
    for (const item of section.items) ids.add(item.id)
  }
  return ids
}

export function uniqueId(taken: Set<string>, makeId: () => string = newId): string {
  let id = makeId()
  while (taken.has(id)) id = makeId()
  return id
}

function insertAt<T>(list: T[], index: number, entry: T): T[] {
  const at = Math.max(0, Math.min(index, list.length))
  return [...list.slice(0, at), entry, ...list.slice(at)]
}

function withFields(item: Item, fields: Partial<ItemFields>): Item {
  const { options, ...rest } = { ...item, ...fields }
  return rest.inputType === 'choice' ? { ...rest, options: options ?? [] } : rest
}

function findItemSection(sections: Section[], itemId: string): Section | undefined {
  return sections.find((section) => section.items.some((item) => item.id === itemId))
}

export function applyOp(sections: Section[], op: DraftOp): Section[] | null {
  switch (op.type) {
    case 'setItem': {
      if (!findItemSection(sections, op.itemId)) return null
      return sections.map((section) => ({
        ...section,
        items: section.items.map((item) => (item.id === op.itemId ? withFields(item, op.fields) : item)),
      }))
    }
    case 'addItem': {
      if (!sections.some((section) => section.id === op.sectionId) || allIds(sections).has(op.item.id)) return null
      return sections.map((section) =>
        section.id === op.sectionId ? { ...section, items: insertAt(section.items, op.index, op.item) } : section,
      )
    }
    case 'removeItem': {
      if (!findItemSection(sections, op.itemId)) return null
      return sections.map((section) => ({ ...section, items: section.items.filter((item) => item.id !== op.itemId) }))
    }
    case 'moveItem': {
      const moving = findItemSection(sections, op.itemId)?.items.find((item) => item.id === op.itemId)
      if (!moving || !sections.some((section) => section.id === op.toSectionId)) return null
      return sections.map((section) => {
        const without = section.items.filter((item) => item.id !== op.itemId)
        return {
          ...section,
          items: section.id === op.toSectionId ? insertAt(without, op.index, moving) : without,
        }
      })
    }
    case 'addSection': {
      if (allIds(sections).has(op.section.id)) return null
      return insertAt(sections, op.index, op.section)
    }
    case 'renameSection': {
      if (!sections.some((section) => section.id === op.sectionId)) return null
      return sections.map((section) => (section.id === op.sectionId ? { ...section, title: op.title } : section))
    }
    case 'removeSection': {
      if (!sections.some((section) => section.id === op.sectionId)) return null
      return sections.filter((section) => section.id !== op.sectionId)
    }
    case 'moveSection': {
      const moving = sections.find((section) => section.id === op.sectionId)
      if (!moving) return null
      return insertAt(
        sections.filter((section) => section.id !== op.sectionId),
        op.index,
        moving,
      )
    }
  }
}

export function startDraft(current: CheckSheetVersion | null): CheckSheetDraft {
  if (!current) return { baseVersion: null, origin: { type: 'editor' }, sections: [] }
  return { baseVersion: current.version, origin: current.origin, sections: current.sections }
}

export interface LoadedState {
  draftExists: boolean
  baseVersion: number | null
}

export interface DraftEdit {
  origin: CheckSheetOrigin
  apply: (sections: Section[]) => Section[] | null
}

export function editOp(op: DraftOp): DraftEdit {
  return { origin: { type: 'editor' }, apply: (sections) => applyOp(sections, op) }
}

export type DraftEditPlan =
  | { kind: 'stale' }
  | { kind: 'refused' }
  | { kind: 'write'; draft: CheckSheetDraft }
  | { kind: 'delete' }

export function planDraftEdit(
  loaded: LoadedState,
  draft: CheckSheetDraft | null,
  pointer: number | null,
  base: CheckSheetVersion | null,
  edit: DraftEdit,
): DraftEditPlan {
  if (loaded.draftExists && !draft) return { kind: 'stale' }
  if (draft && draft.baseVersion !== loaded.baseVersion) return { kind: 'stale' }
  if (!draft && pointer !== loaded.baseVersion) return { kind: 'stale' }

  const sections = edit.apply((draft ?? startDraft(base)).sections)
  if (!sections) return { kind: 'refused' }
  if (deepEqual(sections, base?.sections ?? [])) return { kind: 'delete' }
  return { kind: 'write', draft: { baseVersion: loaded.baseVersion, origin: edit.origin, sections } }
}

export type PublishPlan =
  | { kind: 'stale' }
  | { kind: 'replaced' }
  | { kind: 'invalid'; problems: PublishProblems }
  | { kind: 'publish'; version: number }

export function planPublish(loaded: LoadedState, draft: CheckSheetDraft | null, pointer: number | null): PublishPlan {
  if (!draft || draft.baseVersion !== loaded.baseVersion) return { kind: 'stale' }
  if (pointer !== draft.baseVersion) return { kind: 'replaced' }
  const problems = validateForPublish(draft.sections)
  if (problems.messages.length > 0) return { kind: 'invalid', problems }
  return { kind: 'publish', version: (draft.baseVersion ?? 0) + 1 }
}

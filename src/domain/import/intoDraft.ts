import type { DraftEdit } from '../sheetDraft'
import { allIds, uniqueId } from '../sheetDraft'
import { newId } from '../slug'
import type { ParsedCheckSheet, Section } from '../types'
import { reconcile } from './reconcile'

export function toParsed(sections: Section[]): ParsedCheckSheet {
  return {
    sections: sections.map((section) => ({
      title: section.title,
      items: section.items.map((item) => ({
        label: item.label,
        qty: item.qty,
        inputType: item.inputType,
        ...(item.options === undefined ? {} : { options: item.options }),
        scope: item.scope,
      })),
    })),
  }
}

export function reconcileInto(target: Section[], parsed: ParsedCheckSheet, makeId: () => string = newId): Section[] {
  const taken = allIds(target)
  const issue = (): string => {
    const id = uniqueId(taken, makeId)
    taken.add(id)
    return id
  }

  const { sections } = reconcile(target, parsed, issue)

  const seen = new Set<string>()
  const claim = (id: string): string => {
    const unique = seen.has(id) ? issue() : id
    seen.add(unique)
    return unique
  }
  return sections.map((section) => ({
    ...section,
    id: claim(section.id),
    items: section.items.map((item) => ({ ...item, id: claim(item.id) })),
  }))
}

export function copyEdit(source: Section[]): DraftEdit {
  return { origin: { type: 'editor' }, apply: (sections) => reconcileInto(sections, toParsed(source)) }
}

export function importEdit(parsed: ParsedCheckSheet, spreadsheetId: string): DraftEdit {
  return { origin: { type: 'import', spreadsheetId }, apply: (sections) => reconcileInto(sections, parsed) }
}

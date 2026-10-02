import type { Section } from './types'

export interface PublishProblems {
  messages: string[]
  itemIds: Set<string>
  sectionIds: Set<string>
}

const MAX_ITEMS = 500
const MAX_OPTION_LENGTH = 200

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm
}

function badChoiceOptions(options: string[] | undefined): boolean {
  const list = options ?? []
  if (list.length < 2) return true
  const trimmed = list.map((option) => option.trim())
  return (
    trimmed.some((option) => option === '') ||
    new Set(trimmed).size !== trimmed.length ||
    list.some((option) => option.length > MAX_OPTION_LENGTH)
  )
}

export function validateForPublish(sections: Section[]): PublishProblems {
  const messages: string[] = []
  const itemIds = new Set<string>()
  const sectionIds = new Set<string>()
  const items = sections.flatMap((section) => section.items)

  const blankLabels = items.filter((item) => item.label.trim() === '')
  blankLabels.forEach((item) => itemIds.add(item.id))
  if (blankLabels.length > 0) {
    messages.push(`${blankLabels.length} ${plural(blankLabels.length, 'Item needs a label', 'Items need a label')}`)
  }

  const blankTitles = sections.filter((section) => section.title.trim() === '')
  blankTitles.forEach((section) => sectionIds.add(section.id))
  if (blankTitles.length > 0) {
    messages.push(`${blankTitles.length} ${plural(blankTitles.length, 'Section needs a title', 'Sections need a title')}`)
  }

  const badChoices = items.filter((item) => item.inputType === 'choice' && badChoiceOptions(item.options))
  badChoices.forEach((item) => itemIds.add(item.id))
  if (badChoices.length > 0) {
    const subject = plural(badChoices.length, 'Choice Item needs', 'Choice Items need')
    messages.push(
      `${badChoices.length} ${subject} at least two options, none blank, repeated or over ${MAX_OPTION_LENGTH} characters`,
    )
  }

  if (items.length > MAX_ITEMS) {
    messages.push(`${items.length} Items: a Check Sheet can have at most ${MAX_ITEMS}`)
  }

  return { messages, itemIds, sectionIds }
}

import { parseArgs } from 'node:util'
import { fetchSheet } from '../src/domain/import/fetch'
import { parseCheckSheet } from '../src/domain/import/parse'
import { type ImportReport, reconcile } from '../src/domain/import/reconcile'
import { resolveSpreadsheetId } from '../src/domain/import/source'
import { ask } from './lib/prompt'
import { getCurrentVersion, writeVersion } from './lib/store'
import { parseProjectTarget, resolveTarget } from './lib/target'

function printReport(report: ImportReport): void {
  console.log(`Matched: ${report.matched.length}`)
  console.log(`Changed: ${report.changed.length}`)
  for (const change of report.changed) {
    console.log(`  ${change.section} / ${change.label}: ${change.fields.join(', ')}`)
  }
  console.log(`Added: ${report.added.length}`)
  for (const item of report.added) {
    console.log(`  ${item.section} / ${item.label}`)
  }
  console.log(`Removed: ${report.removed.length}`)
  for (const item of report.removed) {
    console.log(`  ${item.section} / ${item.label}`)
  }
  if (report.sectionsAdded.length > 0) console.log(`Sections added: ${report.sectionsAdded.join(', ')}`)
  if (report.sectionsRemoved.length > 0) console.log(`Sections removed: ${report.sectionsRemoved.join(', ')}`)
  for (const rename of report.sectionsRenamed) {
    console.log(`Section renamed: "${rename.from}" -> "${rename.to}"`)
  }
  if (report.reordered) console.log('Section or Item order changed.')
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      brigade: { type: 'string' },
      appliance: { type: 'string' },
      spreadsheet: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      project: { type: 'string' },
    },
  })

  if (!values.brigade) throw new Error('--brigade is required.')
  if (!values.appliance) throw new Error('--appliance is required.')

  const apiKey = process.env.SHEETS_API_KEY
  if (!apiKey) throw new Error('SHEETS_API_KEY environment variable is required.')

  const target = parseProjectTarget(values.project)
  const db = await resolveTarget(target)

  const current = await getCurrentVersion(db, values.brigade, values.appliance)
  const spreadsheetId = resolveSpreadsheetId(current, values.spreadsheet)
  console.log(`Spreadsheet: ${spreadsheetId}`)

  const grid = await fetchSheet(spreadsheetId, apiKey)
  const parsed = parseCheckSheet(grid)
  const { sections, report, unchanged } = reconcile(current?.sections ?? null, parsed)

  printReport(report)

  const sameSpreadsheet = current?.origin.type === 'import' && current.origin.spreadsheetId === spreadsheetId
  if (unchanged && sameSpreadsheet) {
    console.log('No changes: nothing to import.')
    return
  }
  if (unchanged) {
    console.log('Content unchanged, but the source spreadsheet differs from the current version.')
  }

  if (values['dry-run']) {
    console.log('Dry run: no changes written.')
    return
  }

  const proceed = await ask('Write this as the new current Check Sheet version? [y/N] ')
  if (!proceed) {
    console.log('Aborted.')
    return
  }

  const version = await writeVersion(db, values.brigade, values.appliance, {
    expectedCurrent: current?.version ?? null,
    sections,
    origin: { type: 'import', spreadsheetId },
  })
  console.log(`Wrote Check Sheet version ${version}.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

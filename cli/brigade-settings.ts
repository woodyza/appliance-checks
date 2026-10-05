import { parseArgs } from 'node:util'
import { isValidEmail } from '../src/domain/adminUser'
import { type BrigadeSettingsUpdate, updateBrigadeSettings } from './lib/store'
import { parseProjectTarget, resolveTarget } from './lib/target'

function parseUpdate(values: {
  'report-email'?: string
  'clear-report-email'?: boolean
  'weekly-email'?: string
}): BrigadeSettingsUpdate {
  const reportEmail = values['report-email']?.trim().toLowerCase()
  const clearReportEmail = values['clear-report-email'] === true
  const weeklyEmail = values['weekly-email']

  if (reportEmail !== undefined && clearReportEmail) {
    throw new Error('Use either --report-email or --clear-report-email, not both.')
  }
  if (reportEmail === undefined && !clearReportEmail && weeklyEmail === undefined) {
    throw new Error('Nothing to change: pass --report-email, --clear-report-email or --weekly-email.')
  }
  if (weeklyEmail !== undefined && weeklyEmail !== 'on' && weeklyEmail !== 'off') {
    throw new Error('--weekly-email must be on or off.')
  }
  if (reportEmail !== undefined && !isValidEmail(reportEmail)) {
    throw new Error(`--report-email "${reportEmail}" is not a valid email address.`)
  }

  const update: BrigadeSettingsUpdate = {}
  if (reportEmail !== undefined) update.reportEmail = reportEmail
  if (clearReportEmail) update.reportEmail = null
  if (weeklyEmail !== undefined) update.weeklyEmail = weeklyEmail === 'on'
  return update
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      brigade: { type: 'string' },
      'report-email': { type: 'string' },
      'clear-report-email': { type: 'boolean' },
      'weekly-email': { type: 'string' },
      project: { type: 'string' },
    },
  })

  if (!values.brigade) throw new Error('--brigade is required.')
  const update = parseUpdate(values)

  const target = parseProjectTarget(values.project)
  const db = await resolveTarget(target)
  const { before, after } = await updateBrigadeSettings(db, values.brigade, update)

  console.log(`Settings for ${values.brigade}`)
  console.log(`  before: ${JSON.stringify(before)}`)
  console.log(`  after:  ${JSON.stringify(after)}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

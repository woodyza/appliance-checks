import { checkPercent, isFrozen, renderVersion } from './check'
import { weekday } from './schedule'
import type { AdminUser, Appliance, Brigade, BrigadeSettings, Check, CheckSheetVersion } from './types'

export interface ApplianceInput {
  appliance: Appliance
  check: Check | null
  stamped: CheckSheetVersion | null
  current: CheckSheetVersion | null
}

export interface ApplianceStatus {
  callsign: string
  percent: number
  started: boolean
}

export interface BrigadeSummary {
  brigadeName: string
  appliances: ApplianceStatus[]
}

export interface RecipientSummaries {
  to: string
  summaries: BrigadeSummary[]
}

export interface WeeklyEmail {
  subject: string
  text: string
  html: string
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const FLAGGED_BACKGROUND = '#fdecea'

function scoringVersion(
  check: Check,
  stamped: CheckSheetVersion | null,
  current: CheckSheetVersion,
  today: string,
  checkDay: number,
): CheckSheetVersion {
  if (!stamped) throw new Error(`Missing CheckSheetVersion ${check.checkSheetVersion}`)
  const frozen = isFrozen(check, stamped, today, checkDay)
  return renderVersion(check, frozen, current.version) === current.version ? current : stamped
}

function applianceStatus(input: ApplianceInput, brigade: Brigade, today: string): ApplianceStatus {
  const { appliance, check, stamped, current } = input
  if (!current) throw new Error(`Missing current CheckSheetVersion for ${appliance.callsign}`)
  if (!check) return { callsign: appliance.callsign, percent: 0, started: false }

  const version = scoringVersion(check, stamped, current, today, brigade.checkDay)
  return {
    callsign: appliance.callsign,
    percent: checkPercent(version.sections, check.responses, check.monthly),
    started: true,
  }
}

export function summariseBrigade(brigade: Brigade, inputs: ApplianceInput[], today: string): BrigadeSummary {
  const appliances = inputs
    .filter(({ appliance }) => appliance.active && appliance.currentCheckSheetVersion !== null)
    .map((input) => applianceStatus(input, brigade, today))
    .sort((a, b) => a.callsign.localeCompare(b.callsign))
  return { brigadeName: brigade.name, appliances }
}

export function statusLabel(status: ApplianceStatus): string {
  if (status.percent >= 100) return 'Complete'
  return status.started ? `${status.percent}%` : 'not started'
}

export function isFlagged(status: ApplianceStatus): boolean {
  return status.percent < 100
}

export function wantsWeeklyEmail(settings: BrigadeSettings): boolean {
  return settings.weeklyEmail !== false
}

export function resolveRecipients(brigade: Brigade, settings: BrigadeSettings, admins: AdminUser[]): string[] {
  const reportEmail = settings.reportEmail?.trim().toLowerCase()
  if (reportEmail) return [reportEmail]

  const vsos = admins
    .filter((admin) => admin.role === 'vso' && admin.brigadeIds.includes(brigade.brigadeId))
    .map((admin) => admin.email.toLowerCase())
  return [...new Set(vsos)]
}

export function groupByRecipient(entries: { summary: BrigadeSummary; recipients: string[] }[]): RecipientSummaries[] {
  const byAddress = new Map<string, Set<BrigadeSummary>>()
  for (const { summary, recipients } of entries) {
    for (const recipient of recipients) {
      const to = recipient.toLowerCase()
      byAddress.set(to, (byAddress.get(to) ?? new Set()).add(summary))
    }
  }
  return [...byAddress].map(([to, summaries]) => ({ to, summaries: [...summaries] }))
}

export function formatCheckDate(date: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${WEEKDAYS[weekday(date) - 1]} ${day} ${MONTHS[month - 1]}`
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

interface Row {
  brigadeName: string
  callsign: string
  label: string
  flagged: boolean
}

function buildRows(summaries: BrigadeSummary[]): Row[] {
  return [...summaries]
    .sort((a, b) => a.brigadeName.localeCompare(b.brigadeName))
    .flatMap((summary) =>
      [...summary.appliances]
        .sort((a, b) => a.callsign.localeCompare(b.callsign))
        .map((status, index) => ({
          brigadeName: index === 0 ? summary.brigadeName : '',
          callsign: status.callsign,
          label: statusLabel(status),
          flagged: isFlagged(status),
        })),
    )
}

function renderText(rows: Row[], heading: string, adminUrl: string): string {
  const brigadeWidth = Math.max('Brigade'.length, ...rows.map((row) => row.brigadeName.length))
  const callsignWidth = Math.max('Appliance'.length, ...rows.map((row) => row.callsign.length))
  const line = (marker: string, brigade: string, callsign: string, label: string): string =>
    `${marker} ${brigade.padEnd(brigadeWidth)}  ${callsign.padEnd(callsignWidth)}  ${label}`

  return [
    heading,
    '',
    line(' ', 'Brigade', 'Appliance', 'Completion'),
    ...rows.map((row) => line(row.flagged ? '!' : ' ', row.brigadeName, row.callsign, row.label)),
    '',
    `! = needs follow-up. Go to brigade admin: ${adminUrl}`,
    '',
  ].join('\n')
}

function renderHtml(rows: Row[], heading: string, adminUrl: string): string {
  const cell = (value: string): string => `<td style="padding:4px 12px">${escapeHtml(value)}</td>`
  const header = ['Brigade', 'Appliance', 'Completion']
    .map((title) => `<th style="padding:4px 12px;text-align:left">${title}</th>`)
    .join('')
  const body = rows
    .map((row) => {
      const style = row.flagged ? ` style="background:${FLAGGED_BACKGROUND}"` : ''
      return `<tr${style}>${cell(row.brigadeName)}${cell(row.callsign)}${cell(row.label)}</tr>`
    })
    .join('\n')

  return [
    `<p>${escapeHtml(heading)}</p>`,
    '<table style="border-collapse:collapse">',
    `<tr>${header}</tr>`,
    body,
    '</table>',
    `<p><a href="${escapeHtml(adminUrl)}">Go to brigade admin</a></p>`,
  ].join('\n')
}

export function renderWeeklyEmail(summaries: BrigadeSummary[], checkDate: string, adminUrl: string): WeeklyEmail {
  const statuses = summaries.flatMap((summary) => summary.appliances)
  const incomplete = statuses.filter(isFlagged).length
  const date = formatCheckDate(checkDate)
  const outcome = incomplete === 0 ? 'all complete' : `${incomplete} of ${statuses.length} appliances incomplete`
  const rows = buildRows(summaries)
  const heading = `Appliance checks for ${date}`

  return {
    subject: `Appliance checks, ${date}: ${outcome}`,
    text: renderText(rows, heading, adminUrl),
    html: renderHtml(rows, heading, adminUrl),
  }
}

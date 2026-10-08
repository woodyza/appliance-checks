import { isValidEmail } from './adminUser'
import { MAX_EMAIL_LENGTH } from './brigade'
import { monthLabel } from './report'
import { addDays } from './schedule'
import type { MonthlyReportSettings } from './types'
import { escapeHtml, FLAGGED_BACKGROUND, formatCheckDate, isFlagged, statusLabel } from './weeklyEmail'
import type { BrigadeSummary } from './weeklyEmail'

export interface MonthlyReportEmail {
  subject: string
  text: string
  html: string
}

export function monthlyReportRecipient(settings: MonthlyReportSettings): string | null {
  if (settings.enabled !== true) return null
  const email = settings.email?.trim().toLowerCase() ?? ''
  return isValidEmail(email) && email.length <= MAX_EMAIL_LENGTH ? email : null
}

export function alreadySent(month: string, lastSentMonth: string | undefined): boolean {
  return lastSentMonth !== undefined && lastSentMonth >= month
}

export function shouldSend(summary: BrigadeSummary, checkDate: string, today: string): boolean {
  return summary.appliances.every((status) => !isFlagged(status)) || today >= addDays(checkDate, 7)
}

function renderText(summary: BrigadeSummary, intro: string, heading: string): string {
  const callsignWidth = Math.max('Appliance'.length, ...summary.appliances.map((status) => status.callsign.length))
  const line = (marker: string, callsign: string, label: string): string =>
    `${marker} ${callsign.padEnd(callsignWidth)}  ${label}`

  return [
    intro,
    '',
    line(' ', 'Appliance', heading),
    ...summary.appliances.map((status) => line(isFlagged(status) ? '!' : ' ', status.callsign, statusLabel(status))),
    '',
    '! = needs follow-up.',
    '',
  ].join('\n')
}

function renderHtml(summary: BrigadeSummary, intro: string, heading: string): string {
  const cell = (value: string): string => `<td style="padding:4px 12px">${escapeHtml(value)}</td>`
  const header = ['Appliance', heading]
    .map((title) => `<th style="padding:4px 12px;text-align:left">${escapeHtml(title)}</th>`)
    .join('')
  const body = summary.appliances
    .map((status) => {
      const style = isFlagged(status) ? ` style="background:${FLAGGED_BACKGROUND}"` : ''
      return `<tr${style}>${cell(status.callsign)}${cell(statusLabel(status))}</tr>`
    })
    .join('\n')

  return [`<p>${escapeHtml(intro)}</p>`, '<table style="border-collapse:collapse">', `<tr>${header}</tr>`, body, '</table>'].join(
    '\n',
  )
}

export function renderMonthlyReportEmail(summary: BrigadeSummary, checkDate: string): MonthlyReportEmail {
  const month = monthLabel(checkDate.slice(0, 7))
  const intro = `Monthly Reports for ${month} are attached.`
  const heading = `Last Check (${formatCheckDate(checkDate)})`

  return {
    subject: `Monthly Reports: ${summary.brigadeName}, ${month}`,
    text: renderText(summary, intro, heading),
    html: renderHtml(summary, intro, heading),
  }
}

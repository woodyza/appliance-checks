import { isValidEmail } from './adminUser'

export const CHECK_DAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
]

const MAX_NAME_LENGTH = 60
export const MAX_EMAIL_LENGTH = 254

export interface BrigadeDraft {
  name: string
  checkDay: number | null
  active: boolean
}

export interface NormalisedBrigade {
  name: string
  checkDay: number
  active: boolean
}

export type NormaliseBrigadeResult = { ok: true; brigade: NormalisedBrigade } | { ok: false; problem: string }

export function normaliseBrigade(draft: BrigadeDraft): NormaliseBrigadeResult {
  const name = draft.name.trim()
  if (!name) return { ok: false, problem: 'Enter a name.' }
  if (name.length > MAX_NAME_LENGTH) return { ok: false, problem: `Keep the name to ${MAX_NAME_LENGTH} characters.` }
  if (draft.checkDay === null) return { ok: false, problem: 'Pick a Check Day.' }

  return { ok: true, brigade: { name, checkDay: draft.checkDay, active: draft.active } }
}

export interface ReportSettingsDraft {
  reportEmail: string
  weeklyEmail: boolean
  monthlyReportEnabled: boolean
  monthlyReportEmail: string
}

export interface NormalisedReportSettings {
  reportEmail: string | null
  weeklyEmail: boolean
  monthlyReportEnabled: boolean
  monthlyReportEmail: string | null
}

export type NormaliseReportSettingsResult =
  | { ok: true; settings: NormalisedReportSettings }
  | { ok: false; problem: string }

function validEmail(email: string): boolean {
  return isValidEmail(email) && email.length <= MAX_EMAIL_LENGTH
}

export function normaliseReportSettings(draft: ReportSettingsDraft): NormaliseReportSettingsResult {
  const reportEmail = draft.reportEmail.trim().toLowerCase() || null
  if (reportEmail !== null && !validEmail(reportEmail)) {
    return { ok: false, problem: 'Enter a valid Report Email, or leave it blank.' }
  }

  const monthlyReportEmail = draft.monthlyReportEmail.trim().toLowerCase() || null
  if (draft.monthlyReportEnabled && monthlyReportEmail === null) {
    return { ok: false, problem: 'Add an address to email the Monthly Reports.' }
  }
  if (monthlyReportEmail !== null && !validEmail(monthlyReportEmail)) {
    return { ok: false, problem: 'Enter a valid Monthly Report email address.' }
  }

  return {
    ok: true,
    settings: {
      reportEmail,
      weeklyEmail: draft.weeklyEmail,
      monthlyReportEnabled: draft.monthlyReportEnabled,
      monthlyReportEmail,
    },
  }
}

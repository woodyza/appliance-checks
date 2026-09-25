export const CHECK_TIME_ZONE = 'Pacific/Auckland'

export function today(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHECK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string): string => parts.find((part) => part.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function parseDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDays(date: string, days: number): string {
  const parsed = parseDate(date)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return formatDate(parsed)
}

export function weekday(date: string): number {
  const day = parseDate(date).getUTCDay()
  return day === 0 ? 7 : day
}

export function currentCheckDate(today: string, checkDay: number): string {
  const diff = (weekday(today) - checkDay + 7) % 7
  return addDays(today, -diff)
}

export function nextCheckDate(date: string, checkDay: number): string {
  const diff = (checkDay - weekday(date) + 7) % 7
  return addDays(date, diff === 0 ? 7 : diff)
}

export function checkDatesBetween(from: string, to: string, checkDay: number): string[] {
  let date = currentCheckDate(from, checkDay)
  if (date < from) date = addDays(date, 7)

  const dates: string[] = []
  while (date <= to) {
    dates.push(date)
    date = addDays(date, 7)
  }
  return dates
}

export function isLastOfMonth(date: string): boolean {
  return addDays(date, 7).slice(0, 7) !== date.slice(0, 7)
}

export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`
}

export function firstOfPreviousMonth(date: string): string {
  const [year, month] = date.slice(0, 7).split('-').map(Number)
  const previousMonth = month === 1 ? 12 : month - 1
  const previousYear = month === 1 ? year - 1 : year
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}-01`
}

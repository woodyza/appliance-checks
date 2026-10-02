const ID_FORMAT = /^[A-Za-z0-9_-]{1,32}$/

export function suggestApplianceId(callsign: string): string {
  return /\d+$/.exec(callsign.trim())?.[0] ?? ''
}

export function applianceIdProblem(id: string): string | null {
  if (id === 'admin') return '"admin" can\'t be used as an id.'
  if (!ID_FORMAT.test(id)) return 'Use letters, digits, - or _, up to 32 characters.'
  return null
}

export function callsignProblem(callsign: string): string | null {
  const length = callsign.trim().length
  return length >= 1 && length <= 60 ? null : 'A Callsign is 1–60 characters.'
}

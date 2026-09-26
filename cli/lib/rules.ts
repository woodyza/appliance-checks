const SUPERADMIN_LITERAL = "'emulator-superadmin'"
const UID_PATTERN = /^[A-Za-z0-9]{1,128}$/

export function substituteSuperadmin(rules: string, uid: string | undefined): string {
  const occurrences = rules.split(SUPERADMIN_LITERAL).length - 1
  if (occurrences !== 1) {
    throw new Error(`Expected '${SUPERADMIN_LITERAL}' to occur exactly once in the rules, found ${occurrences}.`)
  }
  if (uid && !UID_PATTERN.test(uid)) {
    throw new Error(`SUPERADMIN_UID must be 1–128 letters and digits (got ${JSON.stringify(uid)}).`)
  }
  return rules.split(SUPERADMIN_LITERAL).join(`'${uid ?? ''}'`)
}

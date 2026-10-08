# Monthly Report email design (#27)

An opt-in email that sends a brigade its Monthly Reports once the month's last Checks are done, or once their window closes. Terminology follows `CONTEXT.md`. Builds on the Monthly Report (`2026-09-27-monthly-report-design.md`) and the weekly VSO email (`2026-10-04-weekly-vso-email-design.md`).

Departures from the issue: none.

## Architecture

- The existing daily 07:00 function is renamed `weeklyVsoEmail` → `dailyEmails`. It runs `sendWeeklyEmails`, then a new `sendMonthlyReportEmails`, logging each pass's `sent` / `skipped` / `failed` separately, and throws at the end if either had a failure. No new Scheduler job.
  - `prod` has no functions deployed yet (#23), so the rename only costs one delete prompt on `dev`.
- `sendMonthlyReportEmails` has the same shape as the weekly pass, with `send` injected. The message type gains `attachments`.
- The weekly pass's appliance-input reading moves somewhere both passes can share.

## When to send

Pure, alongside `weeklyEmail.ts`. For each active brigade whose Monthly Report email is on with an address, on today T with Check Day d:

1. **L**, the target Check: from `currentCheckDate(T, d)`, step back a week at a time until `isLastOfMonth`. The target month is L's month.
2. Skip quietly if the marker's month is on or after the target month (`YYYY-MM` string compare).
3. Score each active Appliance with a Check Sheet on its Check for L, with the weekly email's `summariseBrigade`, so the email, the weekly email and the Monthly Report can't disagree. No such Appliances → skip and log.
4. Send if every Appliance is at 100%, or the window has closed (`T >= L + 7`). Otherwise wait.

Earlier Checks in the month never affect the decision. Only the most recent month is ever sent, so turning it on catches up that month and no older ones.

| Today (Tuesday brigade) | L | State | Result |
|---|---|---|---|
| Wed 30 Sep | Tue 29 Sep | all Complete | send September |
| Wed 30 Sep | Tue 29 Sep | one at 80% | wait |
| Tue 6 Oct | Tue 29 Sep | still 80% | send September, flagged |
| Thu 8 Oct, just turned on | Tue 29 Sep | anything | send September |
| Fri 9 Oct | Tue 29 Sep | marker says `2026-09` | skip |

Accepted limitation: a Check Day change near the end of a month can put L on a date with no Checks, so they score 0% and the email waits for the fallback. The PDFs are still right, since `buildMonthlyReport` includes Checks on their actual dates. Same as the weekly email.

## Data and rules

- **Settings**: `brigades/{slug}/private/monthlyReport`, `{ enabled: boolean, email: string }`. Not on the brigade doc, which anyone can `get`.
  - `isBrigadeAdmin(slug)` (Brigade Admins, VSOs, the superadmin) can read, create and update it. Nobody deletes it.
  - `hasOnly(['enabled', 'email'])`, `email` a string of at most 254 characters, and `enabled == true` needs a non-empty `email`.
  - The job trims and lowercases the address, and skips and logs a brigade whose address is blank or invalid.
- **Sent marker**: `brigades/{slug}/private/monthlyReportSent`, `{ month: 'YYYY-MM', sentAt }`. No rule matches it, so only the function reads or writes it.
- The marker is written only after a successful send, so a failed send is retried by the next day's run. The cost is a rare duplicate if the send succeeds and the marker write fails. That's the opposite of the weekly email's never-double-send, because a missed Monthly Report email would otherwise never go.
- Nothing is resent after the marker is written, whatever changes later.

## PDFs and the email

- `src/report/pdf.ts` splits into `buildMonthlyReportPdf(report, generatedAt)`, which returns the jsPDF document, and the browser's `downloadMonthlyReport`, which calls it then `.save()`s as now. The function attaches `.output('arraybuffer')`. A shared helper names files `<callsign>-<YYYY-MM>.pdf`.
- The "Generated" stamp is formatted in `CHECK_TIME_ZONE`, so the server doesn't print UTC.
- `jspdf` and `jspdf-autotable` become `functions/package.json` dependencies (the bundle keeps packages external). jsPDF 4.2 has a `node` export.
- Each Appliance's report is built server-side like `BrigadeAdminView.download()`: the month's Checks (same query and index as `listChecksInMonth`), the versions they need, then `buildMonthlyReport` with `today = T`.
- The email, in a pure `monthlyReportEmail.ts`:
  - Subject: `Monthly Reports: Mangawhai, September 2026`.
  - Body: "Monthly Reports for September 2026 are attached.", then an Appliance | Last Check (Tue 29 Sep) table using `statusLabel` / `isFlagged`, with anything under 100% highlighted. HTML with a plain-text alternative, no link.
  - One PDF attached per Appliance, sorted by Callsign. A fallback email looks the same apart from the highlighting.
- If any Appliance's report fails to build, the brigade fails for that run (logged, no marker) and is retried the next day, rather than sending a partial set the marker would then lock in.

## Admin UI

- The brigade admin page's details form gets a "Monthly Report email" block, shown to Brigade Admins and VSOs alike: a checkbox, "Email the Monthly Reports when the month's Checks are done", and an address. Hidden on the new-brigade form, since no doc means off.
- `BrigadeDraft` / `normaliseBrigade` gain `monthlyReportEnabled` and `monthlyReportEmail`. Ticked with a blank address → "Add an address to email the Monthly Reports". An invalid address gets the existing invalid-email problem. The address is kept when unticked.
- The page reads the doc on load, and `updateBrigade` writes it in the same batch as the brigade details.
- No CLI changes.

## Docs

- `CONTEXT.md`: add **Monthly Report Email** ("The address a brigade's Monthly Reports are emailed to once the month's last Checks are done. Set by its Brigade Admins or VSOs."). Make **Report Email** about the weekly email, and narrow the **VSO** definition to match. Same rewording for the `isBrigadeVso` comment in `firestore.rules`.
- `docs/infra-setup.md`: the rename, the new email, and the run/log commands.

## Testing

- `tests/domain`: the "when to send" table, plus a marker skip, a December → January boundary and L == T. Email rendering (subject, flagged rows). The new `normaliseBrigade` cases.
- `tests/functions/sendMonthlyReportEmails.test.ts` (emulator, mirroring the weekly test): sends once with one `%PDF` attachment per Appliance when all are Complete; waits when one is incomplete; sends once the window closes; skips once the marker is set; leaves no marker after a failed send; skips a brigade that's off or has no address.
- `tests/rules`: a Brigade Admin can write `monthlyReport`; anonymous users can't read it; `enabled` without an address is rejected; clients can't read or write the marker.
- `tests/e2e/brigadeDetails.spec.ts`: a Brigade Admin turns it on with an address; a blank address shows the problem.
- On `dev`, for the PR: point a seeded brigade at an inbox, run the Scheduler job by hand, and check the logs, as #24 did.

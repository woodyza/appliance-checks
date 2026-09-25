# Check entry design (#5)

Port the Apps Script check UI onto Firestore, so a firefighter can scan an Appliance's QR code and run its Check with no sign-in (ADR 0001). Builds on the foundations design (`2026-09-25-foundations-design.md`). Terminology follows `CONTEXT.md`.

Frozen only pins the Check Sheet version a Check renders against (ADR 0002). Answers on any Check in the current or previous month stay editable.

## Data model

```
brigades/{slug}/checks/{applianceId}_{YYYY-MM-DD}      anonymous: get, bounded list, create, update
  applianceId: string
  scheduledDate: 'YYYY-MM-DD'
  monthly: boolean                // set on create: is this the last Check Day of its month
  checkSheetVersion: int          // version the latest write was made against
  responses: { [itemId]: 'Y' | 'N' | string }   // a cleared answer is a deleted field
  updatedAt: server timestamp
```

- Dates ("today", `scheduledDate`) are computed in `Pacific/Auckland`, a constant in `src/domain`, not the device's time zone, so the #8 Cloud Function computes the same ids. No per-brigade time zone until one's needed.
- `monthly` is stored on create, so a later Check Day change can't flip whether an existing Check includes Monthly Items. A Check that doesn't exist yet uses the brigade's current `checkDay`.
- Version pinning:
  - A Check that isn't Frozen renders the latest Check Sheet, and every write stamps that version.
  - A Frozen Check (Complete against its stamped version, or past its window) renders its stamped version and keeps writing it.
  - "Update to latest Check Sheet" on a Frozen Check writes only the new version number.
  - A Frozen-by-window Check pins the version of its last write, not "latest at window close". They only differ if the sheet changed after someone last touched an incomplete Check, which is acceptable.
  - Answers for Items not in the rendered version stay in the map and are ignored.
- Completeness:
  - Due Items are the Weekly Items, plus the Monthly Items when `monthly` is set.
  - Complete means every due Item has a response. An N counts.
  - Sections with no due Items are hidden.
  - This is a shared pure function, for reuse by #6 and #8.
- Y/N works as it does now: tapping the active answer clears it.
- No `createdAt`. Nothing needs it, and it would make create-vs-update races fail the rules.
- Composite index `checks (applianceId ASC, scheduledDate ASC)` in `firestore.indexes.json`.

## Firestore rules

```
match /checks/{checkId}
  get:            anyone
  list:           resource.data.scheduledDate >= firstOfPreviousMonth()
  delete:         denied
  create, update: validCheckWrite()
```

- `firstOfPreviousMonth()` builds `'YYYY-MM-01'` from `request.time`. The rules only allow a list whose query guarantees that lower bound, and `YYYY-MM-DD` strings sort correctly.
  - TBC: that the rules engine proves a range bound computed from `request.time`. The rules tests settle it.
  - If it can't, add a `scheduledAt` timestamp field and compare it against `timestamp.date(...)` instead.
- Collection-group queries on `checks` stay denied, so listing never crosses brigades.
- `validCheckWrite()` requires:
  - **Keys:** only `applianceId, scheduledDate, monthly, checkSheetVersion, responses, updatedAt`.
  - **Identity:**
    - `checkId == applianceId + '_' + scheduledDate`.
    - On create, the appliance doc exists (one `exists()` read, create only).
    - On update, `applianceId`, `scheduledDate` and `monthly` are unchanged.
  - **Date window:** `scheduledDate` matches `^\d{4}-\d{2}-\d{2}$` and falls between the 1st of the previous month and `request.time + 1 day`. It doesn't check that the date is a real Check Day, so a Check Day change doesn't break it.
  - **Version:** `checkSheetVersion` is an int ≥ 1, and on update ≥ the existing value.
  - **Responses:**
    - `responses` is a map of at most 500 keys.
    - At most one key is added, changed or removed per write (`diff().affectedKeys()`), so the one changed value can be validated without loops.
    - A changed value must be a string of 1–200 chars under a key matching the Item id format.
    - A version-only write (opt-in to latest) changes zero keys.
  - **Timestamp:** `updatedAt == request.time`.
- Values aren't checked against their Item's input type, because that would need a `get()` of the Check Sheet version on every write. Shape and length limits are enough to stop a leaked link becoming a data store.

## UI and data flow

Routes (the slug param only matches the 6-char slug alphabet, as now):

- `/`: the existing scan page.
- `/:slug`: `ApplianceList`, the brigade's active appliances.
- `/:slug/:applianceId`: `CheckView`, which shows:
  - a header with the Callsign, a Switch button back to the list, and the Check selector
  - the Weekly/Monthly pill
  - Section cards with % done
- `/:slug/:applianceId/:sectionId`: `SectionView`, which shows:
  - the Items (Y/N buttons, choice select, written input with "Copy from previous")
  - prev/next Section nav
- The selected Check is in `?check=YYYY-MM-DD`, so browser back and reload keep it. Without it, the default rule applies.

Modules:

- `src/firebase.ts`: app init. It connects to the emulator in local dev and skips App Check there. Otherwise it initialises App Check before Firestore. Uses the default in-memory cache: stations are on wi-fi, so there's no offline persistence.
- `src/domain/schedule.ts` (pure):
  - today in `Pacific/Auckland`
  - scheduled dates for a `checkDay`
  - the current window's date
  - `isLastOfMonth`
  - window end (the next Check Day)
  - `firstOfPreviousMonth`
- `src/domain/check.ts` (pure):
  - due Items and completeness
  - `isFrozen`
  - which version to render
  - the default Check
  - the selector's entries
  - the previous value for a written Item
- `src/data/checks.ts`: thin Firestore access.
  - get brigade, list appliances, get appliance
  - get version (cached in memory, since versions are immutable)
  - list recent Checks
  - write a response, opt in to latest
- The Apps Script CSS gets ported to keep the look. The `html { font-size: 40px }` iframe workaround is dropped and sizes are rescaled to a normal root size.

Loading a Check:

1. Get the brigade (`checkDay`) and the appliance (callsign, `currentCheckSheetVersion`).
2. List the appliance's Checks with `scheduledDate >= firstOfPreviousMonth`. That's one query, and it covers the selector, the default rule and the copy-from-previous lookback. It also finds Checks created under an old Check Day.
3. Pick the default Check: the current window's Check, unless that doc doesn't exist and the latest existing Check before it is started but not Complete. In that case, the latter.
   - This covers late Checks near month end, and applies mid-month too.
   - A previous Check that was never started doesn't count, otherwise one skipped week would pull everyone onto a stale Check.
4. The selector lists every Check from the 1st of the default Check's month up to the current window's Check. It's the union of existing docs and dates computed from the current `checkDay`, sorted, so the current window's Check can always be started.
5. The selected Check renders against its pinned version if Frozen, otherwise the current version. A Check that doesn't exist yet shows at 0% on the current version.
6. "Copy from previous" offers the nearest non-empty value from any earlier listed Check.

Writing:

- Every answer is `setDoc(ref, { applianceId, scheduledDate, monthly, checkSheetVersion, updatedAt: serverTimestamp(), responses: { [itemId]: value | deleteField() } }, { merge: true })`.
  - It's the same call whether or not the doc exists, so two people starting a Check at once both land.
  - `monthly` comes from the loaded doc if there is one, otherwise it's computed.
- The write records the value chosen, not a toggle, so a stale screen can only overwrite the one Item that person tapped.
- The Item updates optimistically and shows a pending marker.
  - On ack, the Check doc is re-read and merged into local state, skipping Items with writes still pending.
  - On failure, the Item reverts and a generic "couldn't save" toast shows. The client can't cleanly tell App Check rejections from rules rejections.
  - A version-decrease rejection (a stale screen after a Check Sheet update) reloads the view.
- Opening a Section re-reads the Check doc. There's no live refresh.
- When the selected Check is Frozen and its version is older than the current one, a banner offers "Update to latest Check Sheet".

## App Check, provisioning and environments

- Provider: reCAPTCHA Enterprise, which Firebase recommends, is scriptable via `gcloud` and has 10k free assessments a month. Default 1h token TTL: usage is tiny, and a short TTL makes a lifted token less useful.
- Web config: `make provision` writes the Firebase web config and reCAPTCHA site key to `.env.dev` / `.env.prod`.
  - They're gitignored like `.firebaserc`, because the config contains the project id (replacing the foundations design's committed env files).
  - A committed `.env.development` holds the emulator's `demo-appliance-checks` config.
- New idempotent `make provision` steps:
  1. Enable the `firebaseappcheck` and `recaptchaenterprise` APIs.
  2. Register the Firebase web app (`firebase apps:create WEB`) and write its `apps:sdkconfig`.
  3. Create a reCAPTCHA Enterprise score key restricted to `<project>.web.app` and `<project>.firebaseapp.com`.
  4. Register it as the app's App Check provider (REST `recaptchaEnterpriseConfig`).
  5. Set Firestore enforcement to `ENFORCED` (REST `services/firestore.googleapis.com`). Nothing reads Firestore from a browser before #5 deploys, so the order doesn't matter.
  6. `dev` only: register an App Check debug token for e2e runs, kept out of git.
- Local dev runs only against the emulator. There's no mode for a local build against `dev`.
- The CLI tools use the Admin SDK and are unaffected.
- To verify on `dev` and record in `docs/infra-setup.md` (and on #5):
  - Whether Enterprise's free tier works on Spark without a billing instrument (the docs conflict). If not, fall back to the reCAPTCHA v3 provider, a small switch in `provision.ts` and `firebase.ts`.
  - Whether requests App Check rejects are billed or count against the Spark quota (undocumented). Script a batch of unattested REST reads, then compare the usage dashboard the next day. If they do count, App Check protects the data but not the quota.

## Testing

- Unit (`tests/domain/`):
  - `schedule.ts`:
    - today across a UTC day boundary
    - the current window's date: on a Check Day, the day after, and early in a month before its first Check Day
    - `isLastOfMonth` in 4- and 5-Check months
    - `firstOfPreviousMonth` across January
  - `check.ts`:
    - due Items, weekly vs monthly
    - completeness: an N counts, hidden Sections, answers for Items not in the version ignored
    - `isFrozen`
    - which version to render
    - the default Check: current exists; current missing with previous started but incomplete; previous never started; previous Complete
    - selector entries across a Check Day change and the late month-end case
    - copy-from-previous walk-back
- Rules (`tests/rules/firestore.rules.test.ts`, emulator). Dates are built with the `schedule.ts` helpers, since `request.time` is the real clock.
  - Anonymous writes outside `checks` are rejected.
  - An unbounded list, a list bounded too early, and a collection-group query on `checks` are rejected. A bounded list is allowed.
  - Malformed writes are rejected: an extra key, an id not matching its fields, two responses in one write, a bad value type or length, a date outside the window, a decreasing version, a missing appliance.
  - A valid create and a valid update succeed.
  - Two contexts answering different Items of a not-yet-existing Check both keep their answers.
- E2E (Playwright, `make e2e` locally against Vite and the emulator, `make e2e ENV=dev` against deployed `dev`; kept out of `make check`):
  - An `e2e:seed` script (Admin SDK, behind the account guard on `dev`) sets up a dedicated E2E brigade:
    - two appliances
    - a fixture Check Sheet version (Weekly and Monthly Y/N, choice, written)
    - a previous Check with a written value
  - The seed script deletes that brigade's Checks before each run.
  - On `dev`, the registered debug token is injected with `addInitScript`. TBC: that the JS SDK honours `FIREBASE_APPCHECK_DEBUG_TOKEN` whichever provider it was initialised with. If it doesn't, the `dev` build needs a debug-provider switch.
  - Specs:
    1. The QR URL opens the current Check with Sections and %s, and a Y answer survives a reload.
    2. Choice and written Items save, and "Copy from previous" fills in the seeded value.
    3. The selector switches Checks, and answers land on the selected one.
    4. Two browser contexts answering different Items of the same Check both keep their answers.
    5. Switch → appliance list → another appliance's Check.
  - Date edge cases stay in unit tests, because faking the browser clock would fight the rules' server-side write window.
- Not unit-tested: `firebase.ts`, `data/checks.ts` and the provision steps. They're thin wrappers covered by e2e and a manual run.

## Doc changes

- `CONTEXT.md`: Frozen answers stay editable; only the Check Sheet version is pinned.
- ADR 0002: the same clarification.
- ADR 0001: anonymous list queries are limited to one brigade's path, and Checks to a recent date range.
- #5's "done when" should read "unbounded list queries on Checks rejected, bounded allowed, cross-brigade rejected" instead of "anonymous list queries rejected".

## Out of scope

Admin sign-in and Monthly Reports (#6), the Check Sheet editor (#7), offline persistence, per-brigade time zones, and checking values against their Item's input type in rules.

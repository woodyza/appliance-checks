# Check entry implementation plan (#5)

Design: `docs/designs/2026-09-26-check-entry-design.md`. Two phases: phase 1 is the data contract (pure domain functions, rules, index), worth reviewing before the UI builds on it; phase 2 is everything that runs it (Firebase client, data layer, UI, provisioning, e2e).

## Decisions and verified facts

- **Rules, verified in the emulator** (throwaway test, deleted):
  - A list rule `resource.data.scheduledDate >= firstOfPreviousMonth()`, with the bound built from `request.time`, is provable: a query `where('scheduledDate', '>=', bound)` (with or without `where('applianceId', '==', x)` + `orderBy('scheduledDate')`) passes; `>= '2000-01-01'` and an unbounded list fail. The design's TBC is settled: no `scheduledAt` fallback needed.
  - Ternaries (`c ? a : b`), `string(int)`, `timestamp.year()/month()/day()` and `request.time + duration.value(1, 'd')` all work.
  - **`Set.toList()` doesn't exist** ("Function not found error: Name: [toList]"), so the one key in `diff().affectedKeys()` can't be indexed. Instead: `newKeys = after.keys().removeAll(before.keys())` and `newValues = after.values().removeAll(before.values())` (both Lists). With `affectedKeys().size() <= 1`, each has at most one element: validate `newKeys[0]` against the Item id pattern and `newValues[0]` as a 1–200 char string. A changed value equal to some existing value drops out of `newValues`, but it's then valid by induction (every value was validated when written, starting from `{}` on create). Verified: added key, changed key, change to a duplicate value, delete via `FieldValue.delete()`, and a zero-key write all pass; two keys, a number, a map value, a 201-char string and a bad key fail. Same behaviour as the design, different mechanism.
- **Item id pattern**: ids come from `newId()` (8 chars of `SLUG_ALPHABET`), so `^[2-9a-hjkmnp-z]{8}$`. Add `ID_PATTERN = '[2-9a-hjkmnp-z]{8}'` next to `SLUG_PATTERN` in `src/domain/slug.ts` (`ID_LENGTH` is already there). Note the alphabet has no `i l o 0 1`, so fixture ids need care (eg `cab22222`, `tch22222`).
- **Time zones**: rules compute bounds in UTC; the client computes them in `Pacific/Auckland` (always ahead of UTC). So the rules' `firstOfPreviousMonth` is ≤ the client's, and the client's today ≤ UTC today + 1 day. The design's `+ 1 day` upper bound covers this.
- **Rules tests and dates**: valid writes use NZ `today()` (what the client does). "Too early" for the write window uses the day before the rules' own UTC bound (`addDays(firstOfPreviousMonth(utcToday), -1)`, `utcToday = new Date().toISOString().slice(0, 10)`); "too late" uses `addDays(utcToday, 3)` (a 2-day margin can flake if the real clock crosses UTC midnight mid-run). "List bounded too early" uses `'2000-01-01'` (a one-day-early bound would flake on the NZ/UTC month boundary).
- **Check Day**: `checkDay` is 1–7, Mon = 1 (foundations design).
- **App Check provisioning uses the Firebase CLI**, not raw REST (a how-deviation from the design's notes): firebase-tools 15 has `appcheck:providers:set recaptcha-enterprise --app <id> --site-key <k> --min-score <s> --token-ttl 1h`, `appcheck:services:set firestore enforced --force` and `appcheck:debugtokens:create [token] --app <id> --display-name <n> --force`. This reuses the account check `provision.ts` already does and avoids handling access tokens. `apps:sdkconfig WEB <appId> --json` returns `result.sdkConfig` (read from the source). `gcloud recaptcha keys create` takes `--display-name --web --integration-type=score --domains=...`.
- **reCAPTCHA min score: 0.3** (design is silent). Spark only gets scores 0.1/0.3/0.7/0.9; a rejected token exchange locks that tab out for a day (firebase-js-sdk#9135), so accepting ≥ 0.3 only rejects the lowest bucket. Flag in the summary.
- **Env vars**: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_RECAPTCHA_SITE_KEY`, `VITE_USE_EMULATOR`. Dev only: `E2E_APPCHECK_DEBUG_TOKEN` (no `VITE_` prefix, so Vite never bundles it). `vite build --mode dev` loads `.env.dev`; `vite` (serve) uses mode `development` → `.env.development`.
- **Emulator QR URL**: `hostingBaseUrl('emulator')` in `cli/lib/target.ts` currently returns the Hosting emulator (`http://127.0.0.1:5000`), which serves a production build with no web config. Local dev is Vite against the emulator, so change it to `http://localhost:5173`. Small unrequested change, needed for "scan opens the Check" locally.
- **vue-router 5** supports regex params (`/:slug([2-9a-hjkmnp-z]{6})`) and nested children; matching is case-insensitive unless the route sets `sensitive: true`. Use `sensitive: true` on the slug routes (slugs are lowercase doc ids).
- **UI shape**: `/:slug/:applianceId` is a parent route (`CheckView`: header, selector, banner, toast, `<router-view>`) with children `''` → `SectionList` and `':sectionId'` → `SectionView`. The loaded session lives in a composable provided by `CheckView`, so moving between the list and a Section doesn't reload everything.
- **Write failure revert**: on a failed write, re-read the Check doc and take the server's value for that Item (falling back to the value before the write if the re-read fails too). This is the design's "reverts", made safe for two quick taps on one Item.
- **Stale version detection**: whenever a re-read Check doc has `checkSheetVersion` greater than the version this screen writes, reload the whole view. That covers the design's version-decrease rejection (the failure path re-reads) and someone else opting the Check in.
- **Extra unit-tested pure helpers** beyond the design's list, because they're real logic: `mergeResponses` (re-read merge skipping pending Items) in `check.ts`, and `.env` file read/render in `cli/lib/envFile.ts`.
- **Doc changes already done** in `f6b3fc5`: `CONTEXT.md` (Frozen answers stay editable), ADR 0001 (list limits), ADR 0002 (freezing only pins the version), and #5's "done when" already has the bounded/cross-brigade wording. Nothing left there.
- **Not run by the implementer**: `make provision` / `make deploy` / `make e2e ENV=dev` against real projects. They're outward-facing and need the user's accounts, so they're handed back (as in #4).
- **Decisions taken after review** (phase 1 review fixes):
  - **Check Day change can hide an in-progress Check**: the original `defaultCheckDate`/`selectorDates` compared existing Checks only against `currentDate`, so a Check created under an old Check Day and still within its own (later) window could vanish from both the default pick and the selector the moment the Check Day changed. `defaultCheckDate` now also takes `today` and first checks for an existing Check with `currentDate < scheduledDate <= today`; `selectorDates` now also takes `today` and includes existing dates up to `today` rather than `currentDate`. The "previous Check" fallback is additionally restricted to the *immediately* previous Check (`nextCheckDate(previous, checkDay) === currentDate`), so an abandoned Check further back with a skipped week in between doesn't pull everyone back onto it.
  - **`checkSheetVersion` is capped at the appliance's `currentCheckSheetVersion`** in `firestore.rules`: a write can't invent a version number ahead of what's actually been published. Create compares directly (`<=`); update only pays for the extra `get()` when the version is actually changing (`version == resource.data.checkSheetVersion || version <= current`), so an ordinary answer write stays read-free.

## Phase 1: domain and rules

**Goal:** the pure schedule and Check logic, the Check data type, Firestore rules and index for Checks, with tests.

**Done when:** `make check` passes; every unit and rules case below exists and passes.

### Tasks

- [x] 1.1 `src/domain/types.ts`: add `Check { applianceId: string; scheduledDate: string; monthly: boolean; checkSheetVersion: number; responses: Record<string, string> }` (no `updatedAt`: the client never reads it).
- [x] 1.2 `src/domain/slug.ts`: add `ID_PATTERN = '[2-9a-hjkmnp-z]{8}'`.
- [x] 1.3 `src/domain/schedule.ts` (pure, dates are `'YYYY-MM-DD'` strings, arithmetic via UTC `Date` so it's time zone free):
  - `CHECK_TIME_ZONE = 'Pacific/Auckland'`
  - `today(now: Date = new Date()): string`, via `Intl.DateTimeFormat` `formatToParts` in `CHECK_TIME_ZONE`
  - `addDays(date, days)`, `weekday(date)` (1 = Mon … 7 = Sun)
  - `currentCheckDate(today, checkDay)`: the latest date ≤ `today` on `checkDay`
  - `nextCheckDate(date, checkDay)`: the first date > `date` on `checkDay` (the window end)
  - `checkDatesBetween(from, to, checkDay)`: every `checkDay` date in `[from, to]`, ascending
  - `isLastOfMonth(date)`: `addDays(date, 7)` is in a later month
  - `firstOfMonth(date)`, `firstOfPreviousMonth(date)`
- [x] 1.4 `src/domain/check.ts` (pure):
  - `isDue(item, monthly)`: weekly, or monthly when `monthly`
  - `sectionProgress(sections, responses, monthly)`: `{ section, due: Item[], answered: number }[]`, only Sections with at least one due Item. Answers for Items not in `sections` are ignored.
  - `isComplete(sections, responses, monthly)`: every due Item has a response (N counts)
  - `isStarted(check)`: at least one response
  - `isFrozen(check, stamped: CheckSheetVersion, today, checkDay)`: Complete against `stamped`, or `today >= nextCheckDate(check.scheduledDate, checkDay)`
  - `renderVersion(check: Check | null, frozen: boolean, currentVersion: number)`: stamped when Frozen, else current
  - `monthlyFor(check: Check | null, date)`: `check.monthly` when it exists, else `isLastOfMonth(date)`
  - `defaultCheckDate(existing: { scheduledDate; started; complete }[], currentDate, today, checkDay)` (decision after review: a Check Day change can otherwise hide an in-progress Check): if any existing Check has `currentDate < scheduledDate <= today` (created under an old Check Day and still in its window), the latest such date; else `currentDate` when an existing Check has it; else the latest existing Check before `currentDate` — its date only if it's started, not Complete, and it's the *immediately* previous Check (`nextCheckDate(its date, checkDay) === currentDate`, so an abandoned Check further back with a skipped week doesn't pull everyone onto it); else `currentDate`
  - `selectorDates(existingDates, defaultDate, currentDate, today, checkDay)` (decision after review: same Check Day change concern): sorted, de-duplicated union of `checkDatesBetween(firstOfMonth(defaultDate), currentDate, checkDay)` and existing dates in `[firstOfMonth(defaultDate), today]` (`today`, not `currentDate`, so a Check still in its window under an old Check Day stays selectable)
  - `previousValue(itemId, selectedDate, checks)`: the value from the nearest Check with `scheduledDate < selectedDate` that has a non-empty value for `itemId`, else `null`
  - `mergeResponses(local, fresh, pending: ReadonlySet<string>)`: `fresh`, except pending Item ids keep their local value (or absence)
- [x] 1.5 `firestore.rules`: inside `brigades/{slug}`, add `match /checks/{checkId}` per the design: `get` anyone; `list` if `resource.data.scheduledDate >= firstOfPreviousMonth()`; `delete` denied; `create` / `update` via a shared `validCheckWrite(checkId, before)` (`before` = `{}` on create, `resource.data.responses` on update). Helpers: `pad2`, `dateString(t)`, `firstOfPreviousMonth()`. `validCheckWrite` checks:
  - keys `hasAll` and `hasOnly` the six fields; `applianceId is string`, `monthly is bool`, `responses is map`, `responses.size() <= 500`
  - `checkId == applianceId + '_' + scheduledDate`
  - `scheduledDate` matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`, `>= firstOfPreviousMonth()`, `<= dateString(request.time + duration.value(1, 'd'))`
  - `checkSheetVersion is int && >= 1`
  - responses: `affectedKeys().size() <= 1`, plus the `removeAll` key/value checks above
  - `updatedAt == request.time`
  - create also: `exists(/databases/$(database)/documents/brigades/$(slug)/appliances/$(request.resource.data.applianceId))`
  - update also: `monthly` unchanged (`applianceId`/`scheduledDate` follow from the id check), `checkSheetVersion >= resource.data.checkSheetVersion`
  - No collection-group rule, so collection-group queries on `checks` stay denied.
- [x] 1.6 `firestore.indexes.json`: composite index on collection `checks`, `COLLECTION` scope, `applianceId ASC, scheduledDate ASC`.
- [x] 1.7 `tests/rules/firestore.rules.test.ts`: replace the check seed/`denies getting a check`/`check` write case with the Checks cases below. Keep the other existing cases. Build dates with `schedule.ts`.

### Test cases

`tests/domain/schedule.test.ts`:
1. `today(new Date('2026-03-31T11:30:00Z'))` → `'2026-04-01'` (NZDT +13, crosses the UTC day), and `today(new Date('2026-03-31T10:30:00Z'))` → `'2026-03-31'`.
2. `currentCheckDate` with `checkDay` 1 (Mon): on Monday `2026-09-21` → itself; on Tuesday `2026-09-22` → `2026-09-21`; on Thursday `2026-10-01` (before October's first Monday) → `2026-09-28`.
3. `nextCheckDate('2026-09-21', 1)` → `'2026-09-28'`; with `checkDay` 4 (a changed Check Day) → `'2026-09-24'`.
4. `isLastOfMonth`: June 2026 has 5 Mondays (1, 8, 15, 22, 29) → only `2026-06-29` true, `2026-06-22` false; September 2026 has 4 Mondays (7, 14, 21, 28) → `2026-09-28` true, `2026-09-21` false.
5. `firstOfPreviousMonth('2026-01-15')` → `'2025-12-01'`; `('2026-03-31')` → `'2026-02-01'`.
6. `checkDatesBetween('2026-09-01', '2026-09-21', 1)` → `['2026-09-07', '2026-09-14', '2026-09-21']`.

`tests/domain/check.test.ts` (fixture: Section A with a weekly yn, a Monthly yn and a written Item; Section B with only a Monthly yn):
7. `sectionProgress` on a weekly Check → Section A with 2 due Items, Section B hidden; on a monthly Check → both Sections, A with 3 due.
8. `isComplete`: all due answered with one `'N'` → true; one due missing → false; an answer for an Item id not in the version doesn't count towards completeness (missing due Item + stray answer → false).
9. `isFrozen`: Complete against stamped, window open → true; incomplete, `today` = `nextCheckDate` → true; incomplete, `today` the day before → false.
10. `renderVersion`: Frozen → `check.checkSheetVersion`; not Frozen → current; `null` Check → current.
11. `monthlyFor`: existing Check with `monthly: false` on a last-of-month date → false; `null` on a last-of-month date → true.
12. `defaultCheckDate`: current exists → current; current missing, previous started and incomplete and immediately previous → previous; current missing, previous never started (`started: false`) → current; current missing, previous Complete → current; no existing Checks → current; a started, incomplete Check from an old Check Day still within `(currentDate, today]` → that Check's date (Check Day change doesn't hide it); a started, incomplete previous Check that isn't the immediately previous one → current; existing `[`a started/incomplete Check, a later Complete Check`]` → current (only the latest previous Check is considered).
13. `selectorDates`: Check Day changed from Monday to Thursday mid-month, existing Monday docs `2026-09-07`, `2026-09-14`, current `2026-09-24` → `['2026-09-03', '2026-09-07', '2026-09-10', '2026-09-14', '2026-09-17', '2026-09-24']` (union, sorted, no duplicates when a doc matches a computed date); an existing Check still within its window past `currentDate` (up to `today`) stays in the selector after a Check Day change; an existing date after `today` is excluded.
14. `selectorDates` late month-end case: default `2026-09-28` (incomplete, previous month), current `2026-10-05`, Monday → `['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']`; an existing date equal to a computed one counts once; an existing date before `firstOfMonth(defaultDate)` is excluded.
15. `previousValue`: walks back past a Check with no value and one with an empty string to the nearest non-empty value; ignores Checks on or after the selected date; returns `null` when none.
16. `mergeResponses`: fresh value for a non-pending Item replaces local; a pending Item keeps its local value even when fresh differs; a pending Item cleared locally stays absent when fresh has it.

`tests/rules/firestore.rules.test.ts` (seed: brigade, appliance `8011`, a second brigade with its own Check; a valid write is `{ applianceId: '8011', scheduledDate: today(), monthly: false, checkSheetVersion: 1, updatedAt: serverTimestamp(), responses: { cab22222: 'Y' } }` with `set(..., { merge: true })` at `checks/8011_${today()}`):
17. Anonymous writes to brigade, settings, appliance and version are denied (existing `it.each`, minus the check row).
18. `get` on a Check is allowed.
19. List: unbounded → denied; `scheduledDate >= '2000-01-01'` → denied; collection-group `checks` with the bound → denied; `applianceId == '8011'`, `scheduledDate >= firstOfPreviousMonth(today())`, `orderBy('scheduledDate')` → allowed.
20. A valid create succeeds; answering a second Item (update) succeeds; clearing an answer with `FieldValue.delete()` succeeds; a version-only write raising `checkSheetVersion` with no `responses` in the payload succeeds.
21. Malformed writes each denied: an extra key; a missing key (no `monthly`); a doc id whose date doesn't match `scheduledDate`; two responses in one write; a number value; an empty string; a 201-char string; a key not matching the Item id pattern; `scheduledDate` the day before the rules' UTC bound; `scheduledDate` 2 days after UTC today; `scheduledDate` `'2026-9-1'`; `checkSheetVersion` 0 and 1.5; a decreasing `checkSheetVersion` on update; `monthly` changed on update; `updatedAt` a client `Date`; create for an appliance that doesn't exist; a new key on a Check already holding 500 (seeded with rules disabled).
22. Delete on a Check is denied.
23. Two unauthenticated contexts answering different Items of a not-yet-existing Check concurrently (`Promise.all`) both succeed and the doc ends up with both answers.

## Phase 2: client, UI, provisioning and e2e

**Goal:** a firefighter can open `/:slug/:applianceId` and run the Check against Firestore, with App Check in deployed builds; `make provision` sets App Check up; Playwright covers the flows.

**Done when:** `make check` passes; `make e2e` (emulator) passes all five specs; `npm run build -- --mode development` builds; a phone-width screenshot of the Section list and a Section looks like the Apps Script UI. The `dev` run (`make provision`, `make deploy`, `make e2e ENV=dev`) is handed back to the user.

### Tasks

- [ ] 2.1 Env files: commit `.env.development` (`VITE_USE_EMULATOR=true`, `VITE_FIREBASE_PROJECT_ID=demo-appliance-checks`, dummy `VITE_FIREBASE_API_KEY`/`VITE_FIREBASE_APP_ID`); gitignore `.env.dev` and `.env.prod`. Add `src/env.d.ts` typing `ImportMetaEnv` for the `VITE_*` vars.
- [ ] 2.2 `src/firebase.ts`: `initializeApp` from env; emulator → `getFirestore` + `connectFirestoreEmulator('127.0.0.1', 8080)`, no App Check; otherwise `initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true })` then `getFirestore`. Exports `db`. Default (memory) cache.
- [ ] 2.3 `src/data/checks.ts` (thin, modular SDK): `getBrigade(slug)`, `listAppliances(slug)` (active only, sorted by callsign), `getAppliance(slug, id)`, `getVersion(slug, applianceId, n)` (in-memory cache keyed by slug/appliance/n), `listRecentChecks(slug, applianceId, since)` (`applianceId ==`, `scheduledDate >= since`, `orderBy('scheduledDate')`), `getCheck(slug, checkId)`, `writeResponse(slug, { applianceId, scheduledDate, monthly, checkSheetVersion }, itemId, value: string | null)` (the design's `setDoc` merge, `deleteField()` for `null`), `optInToLatest(slug, fields)` (same fields, no `responses`). `checkId(applianceId, date)` helper.
- [ ] 2.4 `src/state/checkSession.ts`: composable `useCheckSession(slug, applianceId, selected: Ref<string | null>)` holding the reactive session: loading/error state, brigade, appliance, current version, recent Checks, `currentDate`, default and selector dates, selected date, selected Check doc (or `null`), render version and its Sections, progress, `frozen`, `canOptIn` (Frozen and render version < current), and `pending: Set<itemId>`. Implements the design's "Loading a Check" steps 1–6 (loading the stamped version for the latest previous existing Check so `defaultCheckDate` knows if it's Complete, and for the selected Check so `isFrozen` can run). Actions: `select(date)`, `refresh()` (re-read the selected Check, `mergeResponses` with `pending`), `answer(itemId, value | null)` (optimistic, pending marker, write, then refresh; on failure re-read and take the server value, toast), `optIn()` (write, then reload). Any re-read with a higher `checkSheetVersion` than the render version reloads the session. Errors: brigade missing or inactive → "This link isn't valid"; appliance missing or inactive → not found, with a link back to the list; no `currentCheckSheetVersion` → "No Check Sheet yet".
- [ ] 2.5 Router (`src/router.ts`): `/` Landing; `/:slug(SLUG_PATTERN)` → `ApplianceList`; `/:slug(SLUG_PATTERN)/:applianceId` → `CheckView` with children `''` → `SectionList` and `':sectionId'` → `SectionView`; `sensitive: true` on slug routes; catch-all → `/`. The selected Check is `?check=YYYY-MM-DD`: used when it's in the selector, otherwise the default; selector changes `router.replace` the query; Section links keep it.
- [ ] 2.6 Views, porting `apps-script/Index.html`'s markup and behaviour:
  - `src/views/ApplianceList.vue`: brigade name heading, appliance cards linking to `/:slug/:id`.
  - `src/views/CheckView.vue`: header (Callsign; Switch → `/:slug` on the Section list, Back → Section list on a Section), Check selector (`dd/MM/yy` labels), banner "This Check uses an older Check Sheet" + "Update to latest Check Sheet" when `canOptIn`, loading and error screens, toast, `<router-view>`. Provides the session.
  - `src/views/SectionList.vue`: Weekly/Monthly pill (from `monthlyFor`), Section cards with `answered/due` and %.
  - `src/views/SectionView.vue`: calls `refresh()` on open (and on `sectionId` change); due Items only; Y/N buttons (tapping the active answer clears it), choice `<select>` (`— select —` clears), written `<input maxlength="200">` saving trimmed on `change` (empty clears), "Copy from previous" button showing the value when the Item is empty and `previousValue` exists; pending marker (`saving` class); prev/next Section nav over visible Sections; unknown `sectionId` → redirect to the parent.
  - Toast text on a failed save: "Couldn't save. If this keeps happening, this device can't save right now." (per the design notes, don't suggest retrying).
- [ ] 2.7 `src/style.css`, imported in `main.ts`: port the Apps Script CSS (variables, header, cards, progress, Y/N, inputs, nav, toast, spinner). Drop the `html { font-size: 40px }` workaround and the viewport-forcing script; keep `rem` values as they are and scale `px` sizes by ~0.4 (keep 1px borders and tap targets ≥ 44px). DM Sans/DM Mono from Google Fonts in `index.html`. Check with a Playwright screenshot at 390×844.
- [ ] 2.8 `cli/lib/target.ts`: `hostingBaseUrl('emulator')` → `http://localhost:5173`.
- [ ] 2.9 `cli/lib/envFile.ts`: `readEnvFile(path): Record<string, string> | null` (simple `KEY=value` lines, `#` comments, missing file → `null`) and `renderEnvFile(values): string` (header comment saying it's written by `make provision` and gitignored).
- [ ] 2.10 `cli/provision.ts`: add `firebaseappcheck.googleapis.com`, `recaptchaenterprise.googleapis.com` to `SERVICES`; after `ensureHosting`, new idempotent steps: `ensureWebApp` (`apps:list WEB --json`, find display name `appliance-checks-web`, else `apps:create WEB appliance-checks-web --json`), `webConfig` (`apps:sdkconfig WEB <appId> --json` → `result.sdkConfig`), `ensureRecaptchaKey` (`gcloud recaptcha keys list --format=json` by display name `appliance-checks-web`, else create with `--web --integration-type=score --domains=<p>.web.app,<p>.firebaseapp.com`; site key = last segment of `name`), `setAppCheckProvider` (`appcheck:providers:set recaptcha-enterprise --min-score 0.3 --token-ttl 1h`), `enforceFirestore` (`appcheck:services:set firestore enforced --force`), dev only `ensureDebugToken` (reuse `E2E_APPCHECK_DEBUG_TOKEN` from the existing `.env.dev`, else `randomUUID()`; always `appcheck:debugtokens:create <token> --display-name appliance-checks-e2e --force`), then write `.env.<env>`. Pass `--project <id> --non-interactive` to every `firebase` call. End by noting enforcement can take 15 minutes.
- [ ] 2.11 `cli/deploy.ts`: fail early with "run make provision" when `.env.<env>` is missing.
- [ ] 2.12 `cli/e2e-seed.ts` (`--project emulator|dev`, refuses `prod`, uses `resolveTarget` so `dev` is behind the account guard): overwrites brigade `e2etst` (`checkDay: weekday(today())`, so the current Check is today's), its `private/settings`, appliances `e2e1` ("E2E 1") and `e2e2` ("E2E 2") at version 1 with a fixture `checkSheetVersions/1` (Section "Cab": weekly yn Torch, Radio, Helmet, weekly choice Fuel `['1/4','1/2','3/4','FULL']`; Section "Road user details": weekly written Rego expiry and Odometer; Section "Monthly": monthly yn Ladder; ids valid for `ID_PATTERN`), deletes every doc in `brigades/e2etst/checks`, then seeds for date `addDays(currentCheckDate, -7)`: `e2e1` a Complete Check (every Item answered, Rego expiry `31/12/26`), `e2e2` a started, incomplete Check (Torch Y only). `npm run e2e:seed` script.
- [ ] 2.13 Playwright: `@playwright/test` dev dependency, `playwright.config.ts` (`testDir: tests/e2e`, one worker, not fully parallel, chromium at phone size; `E2E_ENV=emulator` → `baseURL http://localhost:5173` with `webServer: npm run dev` (reuse existing); `E2E_ENV=dev` → `https://<dev project id>.web.app` from `.firebaserc`, token from `.env.dev` via Vite's `loadEnv`). `tests/e2e/fixtures.ts` extends `test` so every context gets `addInitScript` setting `self.FIREBASE_APPCHECK_DEBUG_TOKEN` when there's a token. Make sure eslint/tsconfig cover it and vitest doesn't pick up `*.spec.ts`.
- [ ] 2.14 Makefile: `e2e` (emulator: `emulators:exec --only firestore` running the seed then `playwright test`, with the Java 21 PATH; `ENV=dev`: seed against dev then `E2E_ENV=dev playwright test`), kept out of `check`. `.gitignore`: `test-results/`, `playwright-report/`.
- [ ] 2.15 Docs: README (layout: `src/data`, `src/state`, `tests/e2e`; `make e2e`; `npx playwright install chromium` prerequisite; env files; local dev URL); `docs/infra-setup.md` (new provision steps, `.env.<env>` files and that they're gitignored, the 15-minute enforcement wait, `make e2e ENV=dev`, and the two TBC checks from the design: Enterprise on Spark without billing, and whether App Check-rejected requests count against quota, with how to check).

### Test cases

E2E (`tests/e2e/`, against the seed above, run in this order with one worker; each spec uses its own Items so order doesn't matter):
24. `checkEntry.spec.ts` "opens the current Check": `/e2etst/e2e1` shows "E2E 1", Sections with %, the selector on today's date; tapping Torch Y marks it, and after a reload it's still Y.
25. "saves choice and written Items": Fuel `1/2`, Odometer typed then blurred, "Copy from previous" on Rego expiry shows and fills `31/12/26`; all three survive a reload.
26. "answers land on the selected Check": `/e2etst/e2e2` defaults to the seeded incomplete previous Check (late Check rule); switching the selector to today's Check and answering Radio Y lands on today's Check (reload with `?check=<today>` shows it; the previous Check's Radio is still empty).
27. "two people answering different Items both keep their answers": two browser contexts on `e2e1`'s current Check answer Helmet N and Radio Y at once; after a reload each sees both.
28. "switches appliance": Switch → appliance list shows both callsigns → E2E 2 opens its Check.

Unit (`tests/cli/lib/envFile.test.ts`):
29. `readEnvFile` parses `KEY=value` lines, skips comments and blank lines, keeps `=` inside values; missing file → `null`.
30. `renderEnvFile` output reads back to the same values.

## Traceability

| Design requirement | Change | Tests |
|---|---|---|
| Check doc shape, id, no `createdAt` | 1.1, 1.5, 2.3 | 20, 21 |
| NZ dates, schedule helpers | 1.3 | 1–6 |
| `monthly` stored on create; Check Day change only affects new Checks | 1.4 `monthlyFor`, 1.5 (unchanged on update), 2.3 | 11, 13, 21 |
| Version pinning, Frozen, opt-in | 1.4, 1.5 (version ≥), 2.4, 2.6 banner | 9, 10, 20, 21 |
| Completeness, hidden Sections, stray answers ignored | 1.4 | 7, 8 |
| Y/N clears on re-tap | 2.6 | 24 |
| Composite index | 1.6 | (deploy) |
| Rules: get/list/delete/create/update | 1.5 | 17–23 |
| Routes, `?check=` | 2.5 | 24–28 |
| `firebase.ts`, App Check, emulator | 2.1, 2.2 | e2e, dev run |
| Loading steps, default Check, selector, copy-from-previous | 1.4, 2.4 | 12–15, 25, 26 |
| Per-Item writes, re-read on Section open and after writes, pending, failure toast, version reload | 1.4 `mergeResponses`, 2.3, 2.4 | 16, 23, 27 |
| Ported CSS | 2.7 | screenshot |
| Provisioning, env files, debug token | 2.9, 2.10, 2.11 | 29, 30, dev run |
| E2E seed and specs | 2.12–2.14 | 24–28 |
| Docs | 2.15 | review |

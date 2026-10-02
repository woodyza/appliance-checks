# User admin implementation plan (#2)

Design: [`docs/designs/2026-09-28-user-admin-design.md`](../../designs/2026-09-28-user-admin-design.md). One phase: the rules, views and specs only make sense together, and nothing here is an interface worth reviewing on its own first.

## Decisions and verified facts

- **Pre-hijacking (emulator, verified):** a password sign-up for an email, followed by an email-link sign-in for the same email, is one account (same UID); the link marks it verified, and the earlier password still signs in with `email_verified: true`. Both report `sign_in_provider: "password"`. The user chose to accept and document it (design updated); no provider pinning.
- **`in` query (emulator, verified):** with `allow list: if isAdmin() && resource.data.brigadeId in adminBrigadeIds()`, `where('brigadeId', 'in', ['A'])` and `== 'A'` succeed, `in ['A', 'B']` (B unassigned) and an unfiltered list fail, and `.lower()` on a mixed-case token email finds a lower-case doc id.
- **Rules helpers that call `get()`/`exists()` live inside `match /databases/{database}/documents`**, not at `service` level with the others: `$(database)` is only bound inside that match, and at `service` level the emulator fails the request with a Null value error. Found by the implementer (who first inlined the lookups); fixed in the diff check by moving the helpers, which keeps the design's `isAdmin()`/`adminBrigadeIds()`/`isBrigadeAdmin()`.
- **Token claims are read with `request.auth.token.get('email', null)` / `get('email_verified', false)`**, not `.email`, so a signed-in user without an email claim (the superadmin test context, `some-other-uid`) doesn't raise an error inside the new helpers. `isSuperadmin()` stays first in every `||`.
- **The superadmin test helper gets no email claim**: every superadmin path short-circuits on `isSuperadmin()`, so the design's "helpers need an email claim" applies to the new admin helper only.
- **`ReportView.vue` becomes `BrigadeAdminView.vue` (`git mv`)**, and the hub is a new `AdminHub.vue`. The design says ReportView is "repurposed into a nav hub", but its content (the picker) is what moves to `/:slug/admin`; keeping the file name on the hub would mislead.
- **Shared gate:** the hub, User Admin and Brigade Admin pages all run the same `listBrigades()` probe and show the same header/loading/"Not authorised"/error states. That goes in one composable (`useAdminGate`) and one frame component (`AdminFrame.vue`) rather than three copies. BrigadeAdminView finds its brigade in the gate's list; a slug not in it shows "This link isn't valid.".
- **Form validation is a pure function** (`src/domain/adminUser.ts`), unit tested. The design says no unit tests for the data/auth wrappers, which still holds; the form is the only thing enforcing "Brigade Admin has exactly one brigade", so it's decision logic worth a test.
- **Switching a VSO to Brigade Admin keeps only the first brigade** (changed in the diff check from "let validation catch it"): the single select only shows the first, so failing on the hidden rest was confusing.
- **`AdminUser` has no `createdAt`** (review P3): nothing reads it, and converting it made the whole list fail on a doc without one. `createAdminUser` still writes it.
- **Adding an email that's already listed** is refused in the form ("Already added"), so a create never silently overwrites `createdAt`. Edits use `updateDoc` on `displayName`, `role` and `brigadeIds` only.
- **User Admin CRUD gets an e2e spec** (emulator only). The design left this open, leaning manual; the email normalisation is exactly the kind of thing that fails silently, and the sign-in helper already exists.
- **Inactive brigade e2e** uses a second seeded brigade `e2ezzz` (slugs exclude `o`, `i`, `l`, so not `e2eoff`), via a new `active` option on `writeBrigade`.
- **The plan is committed**, like the earlier slices' plans (AGENTS.md makes it part of each slice), which overrides the plan-and-implement default of leaving it uncommitted.

## Phase 1

**Goal:** everything in the design: rules for all three roles, the superadmin hub/User Admin/Brigade Admin pages, the inactive landing page, the specs and docs.

**Done when:** `make check` passes; `make e2e` (emulator) passes; every test case below exists and passes; tasks ticked.

### Changes

- [x] 1.1 `firestore.rules`
  - After `isSuperadmin()` (`:19-21`): `adminEmail()`, `hasVerifiedEmail()` (`request.auth != null && token.get('email', null) != null && token.get('email_verified', false) == true`), `isAdmin()`, `adminBrigadeIds()`, `isBrigadeAdmin(slug)` per the design.
  - `brigades/{slug}` list (`:50`): `isSuperadmin() || (isAdmin() && resource.data.brigadeId in adminBrigadeIds())`.
  - `checks` list (`:68`): append `|| isBrigadeAdmin(slug)`.
  - New `match /adminUsers/{email}`: `get` if `isSuperadmin() || (hasVerifiedEmail() && email == adminEmail())`; `list` if `isSuperadmin()`; `create, update` if `isSuperadmin() && email == email.lower() && request.resource.data.email == email`; `delete` if `isSuperadmin()`.
- [x] 1.2 `src/domain/types.ts`: drop `assignedVsoId` (`:14`); add `AdminRole = 'brigadeAdmin' | 'vso'` and `AdminUser { email, displayName: string | null, role, brigadeIds: string[] }` (see Decisions on `createdAt`).
- [x] 1.3 `src/domain/adminUser.ts` (new, pure): `AdminUserDraft { email: string; displayName: string; role: AdminRole; brigadeIds: string[] }` and `normaliseAdminUser(draft)` → `{ ok: true; user: { email, displayName, role, brigadeIds } } | { ok: false; problem: string }`. Trims and lower-cases the email; trims `displayName`, `''` → `null`; problems: email without a single `@` with text either side ("Enter an email address."), Brigade Admin with a brigade count other than 1 ("A Brigade Admin has exactly one brigade."), VSO with none ("Pick at least one brigade."). Dedupes `brigadeIds`.
- [x] 1.4 `src/data/admin.ts`: `listAdminUsers()` (sorted by email), `createAdminUser(user)` (`setDoc` at `adminUsers/{user.email}` with `createdAt: serverTimestamp()`), `updateAdminUser(email, { displayName, role, brigadeIds })` (`updateDoc`), `deleteAdminUser(email)`. Thin, untested directly.
- [x] 1.5 `src/state/adminGate.ts` (new): `useAdminGate()` runs `listBrigades()` on mount; returns `loading`, `notAuthorised` (on `permission-denied`), `error` ("Couldn't load brigades."), `brigades`. Moves `isPermissionDenied` out of `ReportView.vue:46-48` (export it; BrigadeAdminView's Download and UserAdminView's writes reuse it).
- [x] 1.6 `src/components/AdminFrame.vue` (new): props `title`, `loading`, `notAuthorised`, `error`; header with the title and "Sign out" (`ReportView.vue:137-155`'s `handleSignOut`), the loading/"Not authorised" + UID/error screens from `ReportView.vue:157-192`, then the default slot. Toast stays per view.
- [x] 1.7 `git mv src/views/admin/ReportView.vue src/views/admin/BrigadeAdminView.vue`: slug from `route.params.slug`; brigade from the gate's list by slug ("This link isn't valid." if missing); drop the brigade `<select>` and `selectedSlug`; load appliances on mount once the gate passes; everything else (appliance/month selects, "No Check Sheet yet", Download, toast) unchanged. Title: the brigade's name.
- [x] 1.8 `src/views/admin/AdminHub.vue` (new): `AdminFrame` titled "Admin"; a "User admin" link to `/admin/users`, then one `appliance-card`-style `router-link` per brigade to `/${slug}`, "(inactive)" after an inactive brigade's name.
- [x] 1.9 `src/views/admin/UserAdminView.vue` (new): `AdminFrame` titled "User admin"; loads `listAdminUsers()` after the gate passes. A card per user: email, display name, role label ("Brigade Admin"/"VSO"), brigade names resolved from the gate's list (an unknown id shows as the raw id). Tapping a card opens the form in edit mode (email read-only, Save/Remove/Cancel; Remove asks `window.confirm`). An "Add" form: email, display name, role select, brigade picker (a `<select>` for Brigade Admin, checkboxes for VSO; switching to Brigade Admin keeps only the first selected brigade; see Decisions). Save runs `normaliseAdminUser`; a problem, or an email already listed ("Already added."), shows inline and doesn't write. Write failures toast; the list reloads after each write.
- [x] 1.10 `src/router.ts`: import `AdminHub`, `BrigadeAdminView`, `UserAdminView` (`:4`); `/admin` → `AdminHub` (`:21`); add `/admin/users` (`requiresAuth`) beside it; add `` `/:slug(${SLUG_PATTERN})/admin` `` → `BrigadeAdminView`, `requiresAuth`, `sensitive: true`, before the `/:slug/:applianceId` record (`:23`), with a one-line comment that it shadows an appliance id'd `admin` (appliance ids come from the CLI).
- [x] 1.11 `src/views/ApplianceList.vue`: a missing brigade still shows "This link isn't valid."; an inactive one sets `brigade` and an `inactive` flag, and the picker screen shows "Checks are disabled for this brigade." instead of the appliance cards. An "Admin" `router-link` (`header-back` class) to `/${slug}/admin` when `currentUser` is set and the brigade loaded (active or not).
- [x] 1.12 `src/state/checkSession.ts:269-272`: split the check; missing → "This link isn't valid.", inactive → "Checks are disabled for this brigade.".
- [x] 1.13 `cli/lib/seed.ts:90-101`: `SeedBrigadeInput.active?: boolean` (default `true`), written to the brigade doc.
- [x] 1.14 `cli/e2e-seed.ts`: also `writeBrigade` `e2ezzz` "E2E Inactive Brigade", one appliance `e2ez1` "E2E Z1", `active: false`; update the log line.
- [x] 1.15 `tests/e2e/signIn.ts` (new): move `latestSignInLink` and the constants from `monthlyReport.spec.ts:8-25`, plus `signIn(page, email)` (request link, wait for "Check your inbox", open the link).
- [x] 1.16 `tests/e2e/monthlyReport.spec.ts`: use `signIn`; "downloads a Monthly Report" goes hub → "E2E Test Brigade" card → `/e2etst` → "Admin" link → `/e2etst/admin`, then picks E2E 3 and the previous month and downloads as before. "not authorised" unchanged apart from `signIn`.
- [x] 1.17 `tests/e2e/userAdmin.spec.ts` (new, skipped on `dev` like `monthlyReport.spec.ts:6`).
- [x] 1.18 `tests/e2e/checkEntry.spec.ts`: the two inactive-brigade specs (below).
- [x] 1.19 `tests/rules/firestore.rules.test.ts`: seed and helpers (below), new `describe('admin users')`, `describe('brigade admin')`.
- [x] 1.20 `tests/domain/adminUser.test.ts` (new).
- [x] 1.21 Docs (below).

### Test cases

`tests/rules/firestore.rules.test.ts`. Seed (rules disabled): `brigades/def456` `{ brigadeId: 'b2', name: 'Other Brigade', checkDay: 1, active: true }`; `adminUsers/jo@example.com` `{ email, displayName: null, role: 'brigadeAdmin', brigadeIds: ['b1'], createdAt }`; `adminUsers/sam@example.com` (VSO, `['b2']`). Helper `adminDb(email, verified = true)` = `authenticatedContext(<uid from email>, { email, email_verified: verified })`. `OLD_LIST` = the existing old-bounded checks query (`:337-344`) as a function of brigade path.

- admin users:
  - `adminDb('Jo@Example.com')` gets `adminUsers/jo@example.com`: allowed.
  - `adminDb('jo@example.com', false)` gets it: denied.
  - `adminDb('sam@example.com')` gets `jo@example.com`: denied.
  - superadmin gets it and lists `adminUsers`: allowed; `adminDb('jo@example.com')` lists: denied.
  - superadmin creates `adminUsers/new@example.com` with `email: 'new@example.com'`: allowed; then deletes it: allowed.
  - superadmin creates `adminUsers/New@example.com` (email `'New@example.com'`): denied.
  - superadmin creates `adminUsers/new2@example.com` with `email: 'other@example.com'`: denied.
  - `adminDb('jo@example.com')` updates its own doc to `brigadeIds: ['b1', 'b2']`: denied.
- brigade admin:
  - `OLD_LIST(abc123)` as `adminDb('jo@example.com')` (assigned `b1`): allowed.
  - `OLD_LIST(def456)` as jo (unassigned): denied.
  - `OLD_LIST(abc123)` as `adminDb('jo@example.com', false)`: denied.
  - `brigades` `where('brigadeId', 'in', ['b1'])` as jo: allowed; `in ['b1', 'b2']`: denied; unfiltered: denied.
- Existing "another signed-in user" and anonymous cases unchanged and passing (they exercise the no-email-claim path through the new helpers).

`tests/domain/adminUser.test.ts` (`normaliseAdminUser`):
- `'  Jo@Example.COM '`, displayName `'  '`, Brigade Admin, `['b1']` → ok, email `jo@example.com`, displayName `null`.
- email `'jo'` → problem "Enter an email address."
- Brigade Admin with `[]` and with `['b1', 'b2']` → problem "A Brigade Admin has exactly one brigade." (one `it.each`).
- VSO with `[]` → problem "Pick at least one brigade."; VSO with `['b1', 'b2', 'b1']` → ok, `['b1', 'b2']`.

`tests/e2e/userAdmin.spec.ts`: sign in as the superadmin; hub → "User admin"; add `  E2E-VSO-<timestamp>@Example.com ` as a VSO for E2E Test Brigade → a card shows `e2e-vso-<timestamp>@example.com`, "VSO" and "E2E Test Brigade"; add the same address again → "Already added."; edit its display name → the card shows it; remove (accept the dialog) → the card is gone. Leaves no doc behind, so re-runs against a running `make dev` stay clean.

`tests/e2e/checkEntry.spec.ts` (anonymous):
- `/e2ezzz` shows "E2E Inactive Brigade", "Checks are disabled for this brigade." and no `.appliance-card`, and no "Admin" link.
- `/e2ezzz/e2ez1` shows "Checks are disabled for this brigade.".

`tests/e2e/monthlyReport.spec.ts`: as 1.16; "not authorised" unchanged.

### Docs updates

- `CONTEXT.md`: **Superadmin** (under Organisation, before Brigade Admin): "The Firebase project owner, who adds and removes Brigade Admins and VSOs, and can administer any brigade." Report Email: "The address a brigade's reports go to, often a shared VSO team address." (drops the assigned-VSO default).
- `docs/adr/0005-admin-users-are-keyed-by-verified-email.md`: keyed by lower-cased email; trusts the token's `email` only with `email_verified`; why not UID (no UID before first sign-in, no self-service claim write); consequences: email change is delete-and-recreate, and the accepted pre-hijacking risk with the revisit trigger (#7).
- `README.md:5`: drop "(not built yet: admin sign-in starts with #6)" in favour of pointing at the Admin sign-in section. `:52-54`: `/admin` (hub), `/admin/users` (User Admin), `/:slug/admin` (Monthly Report picker, reached from the brigade landing page's Admin link); still superadmin-only in the UI until #12, though the rules already grant Brigade Admins and VSOs their brigades.
- `docs/infra-setup.md`, after "Superadmin UID bootstrap": "Checking account pre-hijacking on `dev`": sign up by REST (`accounts:signUp` with the web API key) with a spare address and a password; if App Check on Auth rejects it, note that (it's part of the answer); otherwise sign in at `/admin/sign-in` by link with that address, then `accounts:signInWithPassword` with the password and decode the returned `idToken`'s `email_verified`. `true` means production behaves like the emulator. Mind the Spark email limit.
- Design doc: "Changes during implementation" (after review).

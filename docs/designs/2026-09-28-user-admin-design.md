# User admin design (#2)

Adds Brigade Admin and VSO roles alongside the existing superadmin, plus the superadmin-facing navigation and User Admin page needed to manage them. Builds on the Monthly Report design (`2026-09-27-monthly-report-design.md`), which shipped magic-link sign-in and `/admin` for the superadmin only. Terminology follows `CONTEXT.md`.

## Scope

This slice builds the full data model and Firestore rules for all three roles, but only wires up **superadmin-facing UI**. A signed-in Brigade Admin or VSO can be created and, per the rules, already has real read access to their own brigade(s) — but no page in this slice tailors itself to them: they'd land on the same superadmin-gated screens as anyone else and see "Not authorised" unless they happen to already be the superadmin.

Deferred to a follow-up issue (logged against this one):

- Redirecting a signed-in Brigade Admin straight to their brigade landing page, and a VSO's own hub scoped to their assigned brigades only
- The checks-page "Admin" link becoming role-aware (right now it just checks "is anyone signed in")
- Any post-sign-in routing beyond "always land on `/admin`"

Building the rules correctly for all three roles now, rather than superadmin-only, means the follow-up doesn't need to touch `firestore.rules` again.

## Data model

```
adminUsers/{email}          — doc id is the lower-cased email address
  email: string              (same value as the doc id, kept for display/queries)
  displayName: string | null (a superadmin-entered label, not from Firebase Auth)
  role: 'brigadeAdmin' | 'vso'
  brigadeIds: string[]        (stable Brigade `brigadeId`s, not Brigade Link slugs)
  createdAt: Timestamp
```

**Keyed by email, not UID.** The issue's own sketch keys this by UID, but a UID doesn't exist until the person's first sign-in, and the superadmin adds people by email beforehand. Firebase's email-link sign-in gives every request a verified `request.auth.token.email` claim, so a rule can trust it directly — there's no "claim your record on first sign-in" step, and, more importantly, no self-service write path is needed for that step. `adminUsers` writes stay superadmin-only with no exceptions, which is a meaningfully lower-risk shape than a rule that would let a brand-new user copy a role/`brigadeIds` array into a doc keyed by their own UID.

Trade-off: if an admin's email changes, the superadmin deletes the old doc and creates a new one under the new address — a manual step, the same shape as "reassigning" a user, which the UI already needs to support.

**`brigadeIds` holds stable `brigadeId`s, not slugs**, per ADR-0004's reasoning: an assignment shouldn't silently break if a Brigade Link is ever rotated (no rotation tooling exists yet, but there's no reason to design against it). Resolving `brigadeId -> slug` needs no new index collection: `brigades/{slug}` documents already carry `brigadeId` as a field, so a client that knows its own `brigadeIds` can query `where('brigadeId', 'in', brigadeIds)` directly, and a matching Firestore rule (`resource.data.brigadeId in <the same array>`) is provable the same way the existing Checks list rule already proves a date-bounded query. No collection depends on how a brigade happens to get created (CLI today, potentially a real UI later).

**The superadmin has no `adminUsers` doc.** Their authority stays entirely rules-based (`isSuperadmin()` matching the fixed UID from `.env.<env>`, unchanged from #6), avoiding a bootstrapping problem and keeping the User Admin list purely "Brigade Admins and VSOs".

## Firestore rules

```
function isAdmin() {
  return request.auth != null && request.auth.token.email != null
    && exists(/databases/$(database)/documents/adminUsers/$(request.auth.token.email.lower()));
}

function adminBrigadeIds() {
  return get(/databases/$(database)/documents/adminUsers/$(request.auth.token.email.lower())).data.brigadeIds;
}

function isBrigadeAdmin(slug) {
  return isSuperadmin() || (isAdmin()
    && get(/databases/$(database)/documents/brigades/$(slug)).data.brigadeId in adminBrigadeIds());
}
```

- `adminUsers/{email}`: `get` — superadmin, or the signed-in user reading their own doc (`email == request.auth.token.email.lower()`). `list` and `write` — superadmin only. No shape validation: it's a fully-trusted, single-writer collection, and the UI is responsible for shaping the data, unlike the anonymous Check-write path.
- `brigades/{slug}`: `list` extended to `isSuperadmin() || (isAdmin() && resource.data.brigadeId in adminBrigadeIds())`. Not exercised by any UI in this slice, but ready for the follow-up's "list my brigades" query.
- `brigades/{slug}/checks/{checkId}`: `list` extended from `isSuperadmin() || scheduledDate >= firstOfPreviousMonth()` to `... || isBrigadeAdmin(slug)`. This is the one rule this slice's UI actually exercises: an admin downloading an older Monthly Report for their own brigade.
- Everything else (brigade config, appliances, Check Sheet versions) stays `write: if false` — nothing in this slice needs admin writes there.

## Routing and navigation (superadmin-facing only, per Scope)

- `/admin` — `ReportView.vue` is repurposed into a nav hub: a list of brigades (each linking to its `/:slug` checks page) plus a "User admin" link. Gated exactly as today: attempt `listBrigades()` (an unbounded `list`, superadmin-only); `permission-denied` shows the existing "Not authorised" screen.
- `/admin/users` — new `UserAdminView.vue`, the User Admin page. Same gate.
- `/:slug/admin` — new `BrigadeAdminView.vue`, registered before `/:slug/:applianceId` (matching the existing note about explicit `/admin` routes needing to go first). This is today's `ReportView` picker with the brigade `<select>` removed and `slug` taken from the route instead: pick an appliance and month, then Download. Same gate as above (a `listBrigades()` probe) — I'm not adding a second, brigade-scoped eager check, because appliances, Check Sheet versions and recent Checks are already public; only an old-month Download can actually fail, and it already has a `permission-denied` handler that shows "Not authorised" instead of crashing.
- `ApplianceList.vue` (the checks page) gets an "Admin" link to `/:slug/admin`, shown whenever `currentUser` is signed in — deliberately not checking anything more specific, to avoid adding a Firestore read to every anonymous check-entry page view. A signed-in-but-unauthorised person can click through and land on the same safe "Not authorised" screen.

Accepted constraint: `/:slug/admin` as a static path segment shadows an appliance literally id'd `"admin"`. Appliance ids are assigned via the CLI, so this is worth a one-line warning rather than any code.

## Superadmin User Admin UI (`/admin/users`)

A table of existing Brigade Admins and VSOs — email, display name, role, and brigade name(s) resolved locally from the same `listBrigades()` call already used for the page's gate, so no extra reads are needed to show names instead of ids. A form adds one: email, optional display name, role, and a brigade picker (single-select for Brigade Admin, multi-select for VSO) populated from that same brigade list. Existing entries can have their role, brigades or display name edited, or be removed. Changing an email means delete-and-recreate, per the trade-off noted above.

## Testing

- Rules tests (`tests/rules/firestore.rules.test.ts`): `adminUsers` get (self, superadmin, denied for another signed-in user), list (superadmin only) and write (superadmin only); `isBrigadeAdmin` grants an old-Checks list for an admin's assigned brigade and denies it for an unassigned one; the extended `brigades` list rule. The existing `authenticatedContext` test helpers will need an email claim added, since the new rules read `request.auth.token.email`.
- No new unit tests: `admin.ts`/`auth.ts`-style data and auth wrappers stay thin and untested directly, consistent with how #6 treated them (covered by rules tests plus manual/e2e).
- E2E: the existing "downloads a Monthly Report" and "not authorised" specs drive through `/admin`'s brigade/appliance/month picker directly — that picker moves to `/:slug/admin`, so both specs need restructuring to navigate hub → brigade checks page → Admin link first. Whether to add new specs for the User Admin CRUD flow itself is worth deciding at implementation time; I'd lean towards a manual check on `dev` given the narrowed, superadmin-only scope.

## Doc changes

- `CONTEXT.md`: add "Superadmin" to the glossary — Brigade Admin and VSO are already defined, Superadmin isn't, and this design uses it throughout.
- `README.md`: update the "Admin sign-in" section for the new routes and the hub/Brigade-Admin-page split.

## Out of scope

Brigade Admin/VSO's own landing pages and role-aware navigation (follow-up issue); Check Sheet Editor (#7); emailing reports (#8); Brigade Link rotation tooling; any shape validation on `adminUsers` writes beyond "superadmin only".

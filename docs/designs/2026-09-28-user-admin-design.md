# User admin design (#2)

Adds Brigade Admin and VSO roles alongside the existing superadmin, plus the superadmin-facing navigation and User Admin page needed to manage them. Builds on the Monthly Report design (`2026-09-27-monthly-report-design.md`), which shipped magic-link sign-in and `/admin` for the superadmin only. Terminology follows `CONTEXT.md`.

## Scope

This slice builds the full data model and Firestore rules for all three roles, but only wires up **superadmin-facing UI**. A signed-in Brigade Admin or VSO can be created and, per the rules, already has real read access to their own brigade(s) — but no page in this slice tailors itself to them: they'd land on the same superadmin-gated screens as anyone else and see "Not authorised" unless they happen to already be the superadmin.

Deferred to #12:

- Redirecting a signed-in Brigade Admin straight to their brigade landing page, and a VSO's own hub scoped to their assigned brigades only
- The brigade landing page's "Admin" link becoming role-aware (right now it just checks "is anyone signed in"; see Notes for #12)
- Any post-sign-in routing beyond "always land on `/admin`"

Building the rules correctly for all three roles now, rather than superadmin-only, means the follow-up doesn't need to touch `firestore.rules` again. The rules tests below are what back that up, since no UI in this slice exercises the admin paths.

## Data model

```
adminUsers/{email}          — doc id is the lower-cased email address
  email: string              (same value as the doc id, kept for display/queries)
  displayName: string | null (a superadmin-entered label, not from Firebase Auth)
  role: 'brigadeAdmin' | 'vso'
  brigadeIds: string[]        (stable Brigade `brigadeId`s, not Brigade Link slugs)
  createdAt: Timestamp
```

**Keyed by email, not UID.** The issue's own sketch keys this by UID, but a UID doesn't exist until the person's first sign-in, and the superadmin adds people by email beforehand. Email-link sign-in gives the token a verified `email` claim, so a rule can trust it directly — there's no "claim your record on first sign-in" step, and, more importantly, no self-service write path is needed for that step. `adminUsers` writes stay superadmin-only with no exceptions, which is a meaningfully lower-risk shape than a rule that would let a brand-new user copy a role/`brigadeIds` array into a doc keyed by their own UID.

This only holds if the claim is verified. Provisioning enables the Email provider with `passwordRequired: false`, which allows email link *alongside* email/password, not instead of it. So anyone with the (public) API key can sign up with an admin's address and a password of their choosing, and get a token whose `email` claim is that address but whose `email_verified` is false. Every email-based rule therefore requires `email_verified == true` (see `adminEmail()` below).

Trade-off: if an admin's email changes, the superadmin deletes the old doc and creates a new one under the new address — a manual step, the same shape as "reassigning" a user, which the UI already needs to support.

**Normalisation.** The UI trims and lower-cases the email before writing, and the write rule rejects a doc whose id isn't already lower-case or whose `email` field doesn't match it. Otherwise a mixed-case id would never match the rules' lookup, and that admin would get "Not authorised" with nothing pointing at why.

**`role` is a label only.** The rules never read it: a Brigade Admin and a VSO have the same powers, and the only difference ("exactly one brigade") is enforced by the User Admin form. That's fine with a single, trusted writer.

**`brigadeIds` holds stable `brigadeId`s, not slugs**, per ADR-0004's reasoning: an assignment shouldn't silently break if a Brigade Link is ever rotated (no rotation tooling exists yet, but there's no reason to design against it). Resolving `brigadeId -> slug` needs no new index collection: `brigades/{slug}` documents already carry `brigadeId` as a field, so a client that knows its own `brigadeIds` can query `where('brigadeId', 'in', brigadeIds)` directly. `in` takes at most 30 values, which is far more brigades than a VSO covers.

**The superadmin has no `adminUsers` doc.** Their authority stays entirely rules-based (`isSuperadmin()` matching the fixed UID from `.env.<env>`, unchanged from #6), avoiding a bootstrapping problem and keeping the User Admin list purely "Brigade Admins and VSOs".

**`adminUsers` is the only record of who administers a brigade.** `BrigadeSettings.assignedVsoId` (in `brigades/{slug}/private/settings`, from the foundations design) is dropped: nothing reads it, and it would duplicate `brigadeIds` with no rule keeping the two in step. Several VSOs can hold the same brigade, so "the brigade's assigned VSO" isn't one person any more, and the Report Email definition changes to match (see Doc changes). Any default for Report Email is #8's to decide.

## Firestore rules

```
function adminEmail() {
  return request.auth.token.email.lower();
}

function isAdmin() {
  return request.auth != null && request.auth.token.email != null
    && request.auth.token.email_verified == true
    && exists(/databases/$(database)/documents/adminUsers/$(adminEmail()));
}

function adminBrigadeIds() {
  return get(/databases/$(database)/documents/adminUsers/$(adminEmail())).data.brigadeIds;
}

function isBrigadeAdmin(slug) {
  return isSuperadmin() || (isAdmin()
    && get(/databases/$(database)/documents/brigades/$(slug)).data.brigadeId in adminBrigadeIds());
}
```

- `adminUsers/{email}`:
  - `get`: superadmin, or the signed-in user reading their own doc (`email_verified == true && email == adminEmail()`).
  - `list`: superadmin only.
  - `write`: superadmin only, and on create/update `email == email.lower() && request.resource.data.email == email`. No other shape validation: it's a fully-trusted, single-writer collection, and the UI is responsible for shaping the data, unlike the anonymous Check-write path.
- `brigades/{slug}`: `list` extended to `isSuperadmin() || (isAdmin() && resource.data.brigadeId in adminBrigadeIds())`. Not exercised by any UI in this slice, but ready for #12's "list my brigades" query. I think the rules engine can prove an `in` filter against this, but that's unverified, hence the rules tests below. If it can't, #12 falls back to one `where('brigadeId', '==', id)` query per assigned brigade, which the same rule covers.
- `brigades/{slug}/checks/{checkId}`: `list` extended from `isSuperadmin() || scheduledDate >= firstOfPreviousMonth()` to `... || isBrigadeAdmin(slug)`. This is what lets an admin download an older Monthly Report for their own brigade. In this slice only the superadmin can reach Download (the page gate below), so the admin path is covered by rules tests alone until #12.
- Everything else (brigade config, appliances, Check Sheet versions) stays `write: if false` — nothing in this slice needs admin writes there.

**TBC at implementation: account pre-hijacking.** An attacker could sign up with an admin's address and a password before that admin ever signs in. When the admin later signs in by email link, the account's email becomes verified, and it isn't yet checked whether the attacker's password still signs in to it afterwards. Check this in the Auth emulator; if it does, also require `request.auth.token.firebase.sign_in_provider` to be the email-link provider in `adminEmail()`'s callers.

## Routing and navigation (superadmin-facing only, per Scope)

- `/admin` — `ReportView.vue` is repurposed into a nav hub: a list of brigades (each linking to its `/:slug` brigade landing page) plus a "User admin" link. Gated exactly as today: attempt `listBrigades()` (an unbounded `list`, superadmin-only); `permission-denied` shows the existing "Not authorised" screen.
- `/admin/users` — new `UserAdminView.vue`, the User Admin page. Same gate.
- `/:slug/admin` — new `BrigadeAdminView.vue`, registered before `/:slug/:applianceId` (matching the existing note about explicit `/admin` routes needing to go first). This is today's `ReportView` picker with the brigade `<select>` removed and `slug` taken from the route instead: pick an appliance and month, then Download. Same gate as above (a `listBrigades()` probe), which #12 replaces with a role-aware one.
- `ApplianceList.vue` (the brigade landing page) gets an "Admin" link to `/:slug/admin`, shown whenever `currentUser` is signed in — deliberately not checking anything more specific, to avoid adding a Firestore read to every anonymous page view. A signed-in-but-unauthorised person can click through and land on the same safe "Not authorised" screen.
- **Inactive brigades.** Today `ApplianceList.vue` and `checkSession.ts` both show "This link isn't valid." for an inactive brigade, which would leave its `/:slug/admin` unreachable from the hub. Instead, an inactive brigade's landing page loads its name, the "Admin" link and a "Checks are disabled for this brigade." notice in place of the appliance links. `checkSession.ts` shows the same notice for a direct link to an appliance. A missing brigade still shows "This link isn't valid.". The Check write rules are unchanged: they don't read `active` today, and a stale link to an inactive brigade is no more exposed than a live one (ADR 0001).

Accepted constraint: `/:slug/admin` as a static path segment shadows an appliance literally id'd `"admin"`. Appliance ids are assigned via the CLI, so this is worth a one-line warning rather than any code.

## Superadmin User Admin UI (`/admin/users`)

A table of existing Brigade Admins and VSOs — email, display name, role, and brigade name(s) resolved locally from the same `listBrigades()` call already used for the page's gate, so no extra reads are needed to show names instead of ids. A form adds one: email (trimmed and lower-cased before writing), optional display name, role, and a brigade picker (single-select for Brigade Admin, multi-select for VSO) populated from that same brigade list. Existing entries can have their role, brigades or display name edited, or be removed. Changing an email means delete-and-recreate, per the trade-off noted above. Adding someone doesn't notify them; the superadmin tells them to sign in.

## Notes for #12

- **Role-aware "Admin" link.** The landing page reads the signed-in user's own `adminUsers/{email}` (the self `get` rule) and shows the link when its `brigadeIds` include the brigade's `brigadeId`, which `ApplianceList.vue` already loads. Check `brigadeIds`, not `role`, since Brigade Admins need it too. The rules still decide access; this is only whether to show the link.
- **The superadmin has no doc**, so that read comes back not-found for them, the same as for a stranger. Either keep a `limit(1)` `brigades` list probe for the superadmin, or give the superadmin an `adminUsers` doc as a Brigade Admin of their own brigade (`isSuperadmin()` still covers the rest). The second seems neater, since in practice the superadmin mostly works in one brigade.

## Testing

- Rules tests (`tests/rules/firestore.rules.test.ts`). The `authenticatedContext` helpers need `email` and `email_verified` claims added, since the new rules read both.
  - `adminUsers`: get (self, superadmin, denied for another signed-in user, denied for self with `email_verified: false`); list (superadmin only); write (superadmin only; denied for a mixed-case doc id, or an `email` field that doesn't match the id).
  - `isBrigadeAdmin`: an old-Checks list allowed for an admin's assigned brigade, denied for an unassigned one, and denied for an assigned admin whose token has `email_verified: false`.
  - `brigades` list, as an admin assigned to `A`: `where('brigadeId', 'in', ['A'])` allowed; `where('brigadeId', 'in', ['A', 'B'])` with `B` unassigned denied; an unfiltered list denied.
- No new unit tests: `admin.ts`/`auth.ts`-style data and auth wrappers stay thin and untested directly, consistent with how #6 treated them (covered by rules tests plus manual/e2e).
- E2E: the existing "downloads a Monthly Report" and "not authorised" specs drive through `/admin`'s brigade/appliance/month picker directly — that picker moves to `/:slug/admin`, so both specs get restructured to navigate hub → brigade landing page → Admin link first. The inactive-brigade landing page (notice shown, no appliance links) gets a spec. Whether to add specs for the User Admin CRUD flow itself is worth deciding at implementation time; I'd lean towards a manual check on `dev` given the narrowed, superadmin-only scope.

## Doc changes

- `CONTEXT.md`: add "Superadmin" to the glossary — Brigade Admin and VSO are already defined, Superadmin isn't, and this design uses it throughout. Reword Report Email so it no longer defaults to "the brigade's assigned VSO", eg "The address a brigade's reports go to, often a shared VSO team address."
- `docs/adr/`: a new ADR for keying `adminUsers` by email and trusting the token's verified `email` claim, since that's hard to reverse and depends on the `email_verified` check.
- `README.md`: update the "Admin sign-in" section for the new routes and the hub/Brigade-Admin-page split.

## Out of scope

Brigade Admin/VSO's own landing pages and role-aware navigation (#12); Check Sheet Editor (#7); emailing reports and any Report Email default (#8); Brigade Link rotation tooling; any shape validation on `adminUsers` writes beyond "superadmin only" and the email id check.

## Infrastructure

Spark allows 5 sign-in emails a day, project-wide (Blaze allows 25,000). Fine for the superadmin alone, but probably worth having `prod` on Blaze (#8) before adding admins.

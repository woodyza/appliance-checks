# Brigade Admin and VSO navigation design (#12)

Tailors the admin screens to Brigade Admins and VSOs. #2 (`2026-09-28-user-admin-design.md`) built their data model and rules but only superadmin-facing UI, so today they hit "Not authorised" everywhere, including their own brigade's admin page. UI and routing only: no `firestore.rules` changes. Terminology follows `CONTEXT.md`.

## Admin profile

One reactive profile in `src/state/auth.ts`, resolved when auth state changes and cleared on sign out. A sign-in as someone else replaces it.

| Signed in as | Profile | Reads |
|---|---|---|
| UID equals `VITE_SUPERADMIN_UID` | `superadmin` | none |
| has `adminUsers/{email}` | `admin`: role, `brigadeIds`; a Brigade Admin also gets `homeSlug` | 1, plus a `where('brigadeId', 'in', [id])` query for a Brigade Admin's slug |
| no doc, or no verified email | `none` | 1 (not-found or denied) |
| anonymous | no profile | none |

A read failure (eg network) is an `error` state; admin pages show their existing error screen.

**Superadmin detected by UID, not by probing.** The UID goes into the build: `.env.development` (committed) gets `VITE_SUPERADMIN_UID=emulator-superadmin`, and `cli/deploy.ts` passes the `SUPERADMIN_UID` it already substitutes into the rules to `vite build`, so both come from one value in one command. The alternative, a `limit(1)` unfiltered `brigades` list that only the superadmin may run, infers the role from a side effect of an unrelated rule and would silently misclassify people if that rule widened. If the UID isn't set, nobody is superadmin in the UI, matching the rules.

**No `adminUsers` doc for the superadmin**, despite the issue suggesting one: it would say `role: brigadeAdmin`, so the superadmin would lose the hub unless detected some other way anyway, and they'd appear (and be deletable) in User Admin.

The profile is resolved once per sign-in, so if the superadmin changes someone's brigades mid-session, that person sees it after a reload or a new sign-in. The rules enforce access regardless.

## Routing

`adminHome()` becomes async and reads the profile:

| Profile | Admin home |
|---|---|
| superadmin, VSO | `/admin` |
| Brigade Admin | `/:homeSlug/admin` |
| `none`, or a Brigade Admin whose `brigadeId` matches no brigade (no `homeSlug`) | `/admin` ("Not authorised", which shows the UID used to bootstrap the superadmin) |

Sign-in completion and the signed-in redirect go through it. The landing page's "Admin" link points at `/admin`, and a Brigade Admin opening `/admin` is redirected to their home. `/admin/users` has no redirect; non-superadmins get "Not authorised".

## Page gates

`useAdminGate()`'s unbounded `listBrigades()` probe is replaced by checks against the profile. These only decide what's shown; the rules decide access.

| Page | Allowed | Loads | Otherwise |
|---|---|---|---|
| `/admin` hub | superadmin: "User admin" + all brigades. VSO: only their brigades, no "User admin" | superadmin: `listBrigades()`. VSO: `where('brigadeId', 'in', …)` in batches of 30 (Firestore's `in` limit) | "Not authorised" |
| `/admin/users` | superadmin | `listBrigades()` | "Not authorised" |
| `/:slug/admin`, `/:slug/admin/:applianceId` | superadmin, or the brigade's `brigadeId` is in `brigadeIds` | `getBrigade(slug)` (public `get`) | missing brigade: "This link isn't valid."; otherwise "Not authorised" |

A VSO with one brigade still gets the hub. Inactive brigades behave as today.

## Header links

Follows #2's scheme: left goes up to a named parent, right is the page's action, Sign out only on the admin home.

| Screen | Left | Right |
|---|---|---|
| `/:slug` | "‹ Brigades" for superadmin or VSO (any brigade) | "Manage" for superadmin, or when the brigade's `brigadeId` is in `brigadeIds` |
| `/:slug/admin` | "‹ Appliances" (unchanged) | "Sign out" only for a Brigade Admin on their own brigade |
| hub, `/admin/users`, appliance admin, Check screens | unchanged | unchanged |

Both `/:slug` links stay hidden while the profile loads, so a Brigade Admin never sees "‹ Brigades" flash up. Anonymous visitors cause no extra reads.

```
 Brigade Admin                         VSO
 sign in ─▶ /:slug/admin [Sign out]    sign in ─▶ /admin hub (their brigades) [Sign out]
             ▲ Manage  │ ‹ Appliances              │ brigade card     ▲ ‹ Brigades
             │         ▼                           ▼                  │
            /:slug  (no ‹ Brigades)              /:slug ──────────────┘
                                                   │ Manage   ▲ ‹ Appliances
                                                   ▼          │
                                                 /:slug/admin ┘
```

**VSO back to the hub goes through `/:slug`** (‹ Appliances, then ‹ Brigades: two taps). Rejected: hub cards opening `/:slug/admin` directly (one tap back, but the admin page's buttons would then depend on role, and a VSO would need a new "Checks" button to reach the checks page); and an extra "All my brigades" link under the header (a third kind of navigation, shown only to some).

## Testing

- No rules changes, so no new rules tests; #2 covers the self `get` and the `in` query.
- Unit (`tests/domain/`), on pure functions of the profile:
  - admin home: superadmin and VSO → `/admin`; Brigade Admin → `/:homeSlug/admin`; `none`, or no `homeSlug` → `/admin`
  - "‹ Brigades" shown: superadmin and VSO only
  - "Manage" shown / brigade page allowed: superadmin always; an admin only for their own `brigadeId`
  - brigade-id batching: 31 ids → 2 queries
- E2E. The seed writes a Brigade Admin (active e2e brigade) and a VSO (active and inactive e2e brigades) `adminUsers` doc after the brigades, since `brigadeId` is regenerated each run. Like the other admin specs, these skip against `ENV=dev`.
  - Brigade Admin: sign-in lands on `/:slug/admin`; ‹ Appliances → `/:slug` with Manage and no ‹ Brigades; Manage returns; Sign out; `/admin` redirects home.
  - VSO: sign-in lands on a hub with only their two brigades and no "User admin"; card → Manage → ‹ Appliances → ‹ Brigades → hub; `/admin/users` is "Not authorised".
  - VSO on a brigade that isn't theirs: ‹ Brigades but no Manage; its `/:slug/admin` is "Not authorised".
  - Existing superadmin specs unchanged; the "not authorised" spec now goes through the `none` profile.

## Doc changes

- `README.md`: the admin section notes that a Brigade Admin lands on their brigade and a VSO gets a scoped hub.
- `.env.development`: `VITE_SUPERADMIN_UID`.

## Changes during implementation

- **The landing page's "Admin" link goes to `/admin`** rather than resolving `adminHome()` itself, and relies on the hub's redirect for a Brigade Admin. Same destination, one fewer async path.
- **The appliance page's "copy from another appliance" picker lists only the person's own brigades** for a Brigade Admin or VSO (all brigades for the superadmin, as before). The design didn't cover it; only the superadmin could reach that page before, and the rules don't let anyone else list all brigades.
- **On a brigade's admin page, a non-admin gets "Not authorised" without the brigade being read**; for an admin, a missing brigade is "This link isn't valid." and someone else's is "Not authorised".
- **e2e Brigade Admin and VSO users are seeded on the emulator only**, like the superadmin's Auth user, so dev's User Admin list doesn't fill with fake addresses.
- **Review follow-ups not applied** (both small, behaviour-changing):
  - If a Brigade Admin's profile read fails during the `/admin` redirect but succeeds on the hub's retry, they see "Not authorised" rather than being sent to their brigade; a reload fixes it.
  - The brigade checks page reads the profile once on mount, so after a sign out or account switch in another tab it keeps the old user's "‹ Brigades"/"Manage" links until it's reloaded. The admin pages and rules still check the current user.

## Out of scope

Anything #2 built (the `adminUsers` model, rules, User Admin); live updates to the profile mid-session.

# Admin landing and brigade admin design (#16)

Splits the admin hub into Users and Brigades, moves the User Admin form onto its own screen, and lets brigades be created and edited in the app rather than only via the CLI. Builds on the admin navigation design (`2026-10-05-admin-navigation-design.md`). Terminology follows `CONTEXT.md`.

## Screens

| Screen | Who | Left | Right | Content |
|---|---|---|---|---|
| `/admin` | superadmin | | Sign out | "Users ›", "Brigades ›" |
| `/admin/users` | superadmin | ‹ Admin | | User cards, "+ New user" at the top; a card opens its edit screen |
| `/admin/users/new`, `/admin/users/:email` | superadmin | ‹ Users | | Today's form. Edit mode has Save and Remove; both return to the list |
| `/admin/brigades` | superadmin, VSO | superadmin: ‹ Admin; VSO: none | superadmin: + New; VSO: Sign out | Brigades the person can see (today's hub list), inactive ones marked; a card opens `/:slug/admin` |
| `/admin/brigades/new` | superadmin | ‹ Brigades | | Details and settings form; Save creates the brigade and opens its `/:slug/admin` |
| `/:slug/admin` | superadmin, the brigade's admins | superadmin/VSO: ‹ Brigades; Brigade Admin: none | Brigade Admin: Sign out | "Check entry ›" (to `/:slug`), then three visibly separate sections: Details, Appliances, Reports |
| `/:slug` | anyone | ‹ Brigades → `/admin/brigades` (superadmin/VSO) | Manage (as today) | Unchanged; anonymous visitors still see no admin links |

**Admin home** becomes: superadmin `/admin`, VSO `/admin/brigades`, Brigade Admin `/:homeSlug/admin`, `none` `/admin` ("Not authorised"). `/admin` redirects a VSO or Brigade Admin to their home; `/admin/brigades` redirects a Brigade Admin to theirs.

**Superadmin and VSO go to the admin page first**, since they rarely do checks; "Check entry ›" is a button on that page. Rejected: brigade cards opening `/:slug` with "Manage" from there (#12's shape), which put every admin visit through the checks page. A Brigade Admin reaches checks with the same button, or the appliance's QR code, which is unaffected by signing in.

**Duplicate users** are checked against Firestore in a transaction ("Already added."), since the create screen no longer has the list loaded.

## Brigade Details

Fields: name (1–60 chars), Check Day (Mon–Sun), active, Report Email (optional; trimmed, lower-cased, validated with `isValidEmail`; blank clears it, so the weekly email goes to the brigade's VSOs as today), weekly email on/off (default on).

| | superadmin | the brigade's Brigade Admin / VSO | anyone else |
|---|---|---|---|
| create a brigade | yes | no | no |
| edit name, Check Day, settings | yes | yes | no |
| change `active` | yes | no (shown read-only) | no |
| delete | no | no | no |

**No delete, only deactivate.** Firestore doesn't cascade, so a delete would orphan appliances, Checks and Check Sheet versions, and lose history the Monthly Reports need.

**Create** generates the slug in the browser and writes the brigade and its `private/settings` in one transaction, retrying on a slug collision, like `addAppliance`. The CLI's `create-brigade` and `brigade-settings` stay.

**Check Day changes** keep the Monthly Report design's accepted limitation (phantom 0% columns for the rest of that month). Editing it in the UI makes it easier to hit, but changes stay rare.

## Firestore rules

- `brigades/{slug}`:
  - `create`: superadmin; slug matches the slug pattern; keys exactly `brigadeId`, `name`, `checkDay`, `active`; `brigadeId` a non-empty string, `name` 1–60 chars, `checkDay` an int 1–7, `active == true`.
  - `update`: `isBrigadeAdmin(slug)`; same shape; `brigadeId` unchanged; `active` unchanged unless superadmin.
  - `delete`: denied.
- `brigades/{slug}/private/settings`: `read`, `create`, `update` for `isBrigadeAdmin(slug)`; writes may only hold `reportEmail` (string, ≤ 254 chars) and `weeklyEmail` (bool). `delete` denied. The weekly email function reads it with the Admin SDK, unaffected.

## Testing

- Rules: brigade create (superadmin allowed; VSO denied; bad shape or `active: false` denied), update (own admin allowed; other admin denied; `brigadeId` change denied; `active` change denied for an admin, allowed for superadmin), settings (own admin read/write allowed; anonymous and other admin denied; extra key denied).
- Unit: the brigade form's validation and normalisation; admin home for each profile.
- E2E:
  - User admin moves to list → new/edit screens: add, refuse a duplicate, edit, remove.
  - Superadmin creates a brigade, edits its details and settings, deactivates it.
  - Brigade Admin edits their brigade's settings and sees `active` read-only; "Check entry ›" opens `/:slug`.
  - Navigation specs follow hub → Brigades; a VSO lands on `/admin/brigades`.

## Doc changes

- `README.md`: admin section covers the Users/Brigades split and editing brigades in the app.

## Changes during implementation

- **Brigade admin page layout:** on a wide screen, Appliances sits in the left column with Details and Reports stacked on the right. On a phone the order is Details, Appliances, Reports. Each section is its own bordered panel.
- **Only the superadmin's Save writes `active`.** A Brigade Admin's or VSO's Save leaves it out. Otherwise a value that went stale (eg the superadmin deactivated the brigade meanwhile) would be refused as "Not authorised".
- **The form also caps Report Email at 254 characters**, matching the rule, so the error says what's wrong.
- **The new-brigade form starts with no Check Day picked**, so a brigade isn't created on a default day by accident. The user edit screen drops Cancel, since "‹ Users" does the same.
- **`e2e-seed` deletes brigades named "E2E Created …" on the emulator**, since the brigade spec creates one each run and nothing in the app deletes brigades.
- **Review follow-up not applied:** someone who opens a brigade's `/:slug/admin` they can't manage (eg a Brigade Admin on another brigade's link) gets "Not authorised" with no header link out. Before this change it had "‹ Appliances". It's edge-case only, and the browser's back button still works.

## Out of scope

Deleting brigades; Brigade Link rotation; Check Day history; changes to the CLI tools.

# Check Sheet editor design (#7)

An admin UI for managing a brigade's Appliances and their Check Sheets: add, rename and deactivate Appliances, and build Check Sheets by editing, copying from another Appliance, or importing a public Google Sheet. Builds on the check entry design (`2026-09-26-check-entry-design.md`), which defines Checks, versions and pinning, and the user admin design (`2026-09-28-user-admin-design.md`), which defines the admin roles, rules helpers and navigation. Terminology follows `CONTEXT.md`.

## Scope

- The brigade admin page (`/:slug/admin`) is reorganised into Appliances and Reports, and gains an appliance page holding that Appliance's details and Check Sheet editor.
- Rules allow the superadmin and a Brigade Admin or VSO assigned to the brigade (`isBrigadeAdmin(slug)`). The UI is reached through the existing superadmin navigation and gate, the same split #2 made. #12 makes the gate and links role-aware, after which Brigade Admins and VSOs reach these pages with no further rules changes.
- Brigade admin is used from a full-size monitor at the station, so these pages are desktop-first. On a phone they stack and still work, but aren't optimised.

## Draft and Publish

Edits don't create a version each. They save eagerly to a draft, and **Publish** turns the draft into one new Check Sheet version. This keeps edits from being lost, stops accidental edits reaching Checks, and keeps one version per deliberate change set. Admins never see version numbers. Recorded in ADR 0006.

### Data model

```
brigades/{slug}/appliances/{applianceId}/private/checkSheetDraft    admins only
  baseVersion: int | null       // the version the draft started from; null if the appliance had none
  origin: { type: 'import', spreadsheetId } | { type: 'editor' }
  sections: Section[]           // same shape as a version's sections
```

- One shared draft per Appliance. Two admins editing the same Appliance edit the same draft.
- It's a separate doc so anonymous Check entry, which lists appliances on every visit, doesn't load a whole sheet per appliance, and so unpublished edits aren't anonymously readable.
- Versions are unchanged: `checkSheetVersions/{n}` with `version, createdAt, origin, sections` (ADR 0003). Publish writes `origin` from the draft.

### Behaviour

- **Draft lifecycle.**
  - The first edit creates the draft as a copy of the current version, with `baseVersion` set to its number, `origin` copied from it, or `{ type: 'editor' }` and no Sections if the appliance has no Check Sheet.
  - An edit that leaves the draft's `sections` deep-equal to its base deletes the draft. So "has unpublished changes" is simply "a draft exists".
- **Edits are id-based operations**: set a field on Item X, add an Item at a position in Section S, remove, move (within or across Sections), add, rename, remove or move a Section. Each runs in a transaction that reads the appliance and the draft, applies the op, and writes the draft.
  - A client queues its ops and runs them one at a time, so a fast typist doesn't contend with themselves on one doc.
  - The screen then re-renders from the committed draft, which picks up any other admin's edits. Cells with an uncommitted local edit keep it. There's no live listener.
- **Stale editor.** An op is refused, and the page reloads with "The Check Sheet changed: reloading", when:
  - the screen loaded a draft that no longer exists (published or discarded by someone else), or
  - the draft's `baseVersion` (or the appliance's pointer, when there's no draft) differs from what the screen loaded.
  - So an edit never lands on a base the admin wasn't looking at.
- **Any committed manual edit sets `origin` to `{ type: 'editor' }`.**
- **Publish** is one transaction:
  1. Read the appliance. If `currentCheckSheetVersion` ≠ the draft's `baseVersion`, refuse with "The Check Sheet was replaced since these edits started"; the only way forward is Discard.
  2. Create `checkSheetVersions/{n+1}` (`n+1` is 1 when `baseVersion` is null) with `createdAt: serverTimestamp()` and the draft's `origin` and `sections`.
  3. Set the appliance's `currentCheckSheetVersion` to `n+1`.
  4. Delete the draft.

  This is the same shape as the CLI's `writeVersion` in `cli/lib/store.ts`.
- **Discard** deletes the draft, after a confirm.
- **Ids.** New Items and Sections get `newId()` (`src/domain/slug.ts`), re-drawn if it collides with an id in the sheet. The Check write rules only accept response keys in that format.
- **Copy from another appliance** reconciles the source's current version into the draft with the existing `reconcile()` (source Sections and Items converted to a `ParsedCheckSheet`), against the draft's sections, or the current version's if there's no draft. Items whose labels match keep their ids, so their answers survive. Any id that comes out repeated (eg two same-label Items in one source Section) is re-drawn. It replaces the draft's contents, with a confirm if a draft already exists, and sets `origin` to `editor`. Sources are appliances with a published Check Sheet (active or not, excluding this one) in any brigade the admin can see (the gate's brigade list: every brigade for the superadmin, their own after #12), picked brigade first (starting on this brigade), then appliance, with appliances loaded on selection.
- **Import from Google Sheet** takes a sheet URL or bare id. The id is pulled from a pasted `/spreadsheets/d/<id>/` URL. The field is pre-filled from the draft's `origin` if that's an import, else the current version's if that is (so a re-import after manual edits still offers the sheet). It runs `fetchSheet` → `parseCheckSheet` → `reconcile()` in the browser and reconciles into the draft exactly as Copy does, but sets `origin` to `{ type: 'import', spreadsheetId }`. An `ImportError`, or any Sheets API error (including a missing or invalid key), shows inline and changes nothing. The sheet must be viewable by anyone with the link.
- **Appliance fields write directly to the appliance doc**, not through the draft: Callsign, Active, and Add appliance.

### Answers that no longer fit their Item

Changing an Item's type or removing a choice option can leave a Check that isn't Frozen holding an answer that no longer fits. **An answer only counts if it fits its Item:**

- Y/N: `Y` or `N`
- Choice: one of the Item's options
- Written: any non-empty string

One shared function in `src/domain/check.ts` decides this, and is used by `isComplete`, `sectionProgress`, the Monthly Report's cells (`cellFor` in `src/domain/report.ts`, which already does this for Y/N), and `SectionView`. There, an answer that doesn't fit renders as unanswered (a choice select shows "— select —") and is overwritten when someone answers again. It stays in the responses map, like answers for removed Items.

Answers that still fit survive a rename, a scope change, a type change they still fit (Y/N → Written keeps `Y`), and added options. Frozen Checks are unaffected, because they render against their pinned version, where their answers fit.

| Example | Outcome |
| --- | --- |
| Item renamed mid-Check | answer kept (same id) |
| Item deleted mid-Check | answer ignored in that Check; Frozen Checks keep it |
| Choice option "¾" removed while a Check's answer is "¾" | that Item shows unanswered; the Check is no longer Complete |
| Written → Y/N with answer "Full" | unanswered |
| Y/N → Written with answer "Y" | kept, shows "Y" |
| A Complete (Frozen) Check after any edit is Published | still renders its pinned version and stays Complete |

## Firestore rules

Every new rule is gated by `isBrigadeAdmin(slug)`.

```
match /appliances/{applianceId}
  get, list:  anyone (unchanged)
  create:     isBrigadeAdmin(slug)
              && keys exactly callsign, active, currentCheckSheetVersion
              && callsign is string, 1–60 chars
              && active == true && currentCheckSheetVersion == null
              && applianceId.matches('^[A-Za-z0-9_-]{1,32}$') && applianceId != 'admin'
  update:     isBrigadeAdmin(slug)
              && keys still exactly those three; callsign string 1–60, active bool
              && if currentCheckSheetVersion changed:
                   new == (old == null ? 1 : old + 1)
                   && existsAfter(.../checkSheetVersions/$(string(new)))
  delete:     denied

  match /checkSheetVersions/{version}
    get, list:  anyone (unchanged)
    create:     isBrigadeAdmin(slug)
                && version == string(data.version) && data.version is int
                && getAfter(appliance).data.currentCheckSheetVersion == data.version
                && keys exactly version, createdAt, origin, sections
                && createdAt == request.time
                && origin.type in ['editor', 'import']
                && sections is list
    update, delete: denied

  match /private/checkSheetDraft
    read, delete: isBrigadeAdmin(slug)
    create, update: isBrigadeAdmin(slug) && keys exactly baseVersion, origin, sections
```

- The version `create` and the appliance pointer rule each require the other in the same transaction, via `getAfter` and `existsAfter`. ADR 0003's immutability is now enforced by the rules rather than by "all client writes denied".
- Other `private` docs stay denied.
- Item-level contents aren't validated: rules can't iterate a list, and the writers are trusted admins. The client enforces them (see Validation).
- Publish touches three docs. `isBrigadeAdmin`'s reads (the `adminUsers` doc and the brigade) are deduplicated within the request, so with the appliance `get`/`getAfter` and the `existsAfter` it stays well under the 20-read limit.
- The Check rules are unchanged.

## Screens

### Brigade admin page (`/:slug/admin`)

Two columns, side by side on a desktop:

- **Appliances**: a table of every appliance, including inactive ones (marked): Callsign, id, Active, and Check Sheet status ("No Check Sheet", "Unpublished changes" when a draft exists, otherwise blank). A row opens the appliance page. "+ Add appliance" opens an inline row:
  - Callsign, and an id pre-filled from the Callsign's trailing digits ("Mangawhai 8011" → `8011`), editable.
  - The id is validated as the rules do (letters, digits, `-`, `_`, up to 32, not `admin`).
  - Saving runs a transaction that reads the appliance doc first and fails with "That id is already used" if it exists, because a plain `setDoc` over an existing appliance would pass the update rule as a rename. On success it opens the new appliance's page.
- **Reports**: the existing appliance and month picker and Download, unchanged in behaviour, but listing inactive appliances too, since their past reports are still wanted.

Both use all appliances, so the admin views need an unfiltered appliance list (`listAppliances` in `src/data/checks.ts` filters `active == true` for the anonymous list, which keeps that filter).

### Appliance page (`/:slug/admin/:applianceId`)

Up link "‹ Brigade admin". Uses the shared `useAdminGate`, and finds the brigade in the gate's list as `BrigadeAdminView` does. An unknown appliance shows "This link isn't valid.".

```
‹ Brigade admin   Mangawhai 8011
Callsign [Mangawhai 8011]  Active [●]  QR …/x7k2mq/8011 [Copy]
┌──────────────────────────────────────────────────────────────────────┐
│ Unpublished changes: 3 added · 1 renamed · 1 removed [Discard][Publish]│  ← sticky
├──────────────┬───────────────────────────────────────────────────────┤
│ SECTIONS     │ Cab                                         [⋯]      │
│ ⠿ Cab      12│ ⠿ Label                 Qty  Type      Options  Scope │
│ ⠿ Locker 1  9│ ⠿ Thermal Imaging Cam.  1    Y/N                Monthly│
│ ⠿ Road user 4│ ⠿ Rego expiry                Written            Weekly│
│ + Section    │ ⠿ Fuel level                 Choice    Full,¾…  Weekly│
│              │ + Item                                                │
│ Copy from…   │ Locker 1 (driver side)                      [⋯]      │
│ Import sheet…│ …                                                     │
└──────────────┴───────────────────────────────────────────────────────┘
```

- **Details row.**
  - Callsign commits on blur (1–60 chars).
  - Active toggles straight away. Deactivating asks for confirmation, because the appliance drops off the Brigade Link and its QR link stops opening a Check. Reactivating restores both.
  - The QR link is `<origin>/{slug}/{applianceId}` with a Copy button.
- **Editor.** The whole sheet is one scrolling page, each Section a table. A sticky sidebar lists the Sections (click to jump), with "+ Section", "Copy from another appliance…" and "Import from Google Sheet…".
- **Cells.**
  - Label (required) and Qty (optional; empty saves as `null`) are text cells.
  - Type is a select: Y/N, Choice or Written.
  - Options shows only for Choice, edited one per line in a small multi-line editor, not comma-separated, since imported options can contain commas.
  - Scope is a Weekly/Monthly toggle.
  - Text cells commit on blur or Enter. Selects and toggles commit on change. Tab moves between cells.
  - Each commit is one draft op, with a pending marker. On failure the cell reverts and a "couldn't save" toast shows, as in Check entry.
- **Sections.** The title is edited inline in the table header, with the same commit rules. The header's ⋯ menu has Delete Section, which asks for confirmation if it has Items.
- **Adding.** "+ Item", or Enter on a table's last row, adds a Y/N Weekly Item and focuses its label. "+ Section" adds a Section at the end and focuses its title. A new row or Section left completely empty is dropped on blur, without a draft write.
- **Deleting an Item** is immediate, with an "Undo" toast that re-inserts it at its old position (another draft op).
- **Reordering.** Drag handles (⠿) reorder Sections in the sidebar, and Items within a table or across into another Section's table. Alt+↑/↓ on a focused row moves it within its Section. A move keeps the Item's id. Needs a drag-and-drop dependency that supports dragging between lists with a handle (`vue-draggable-plus`, on SortableJS).
- **Review.** The banner shows when a draft exists, with counts from a diff of the draft against its base version by id:
  - **added**: id not in the base
  - **removed**: id not in the draft
  - **renamed**: label changed (Item) or title changed (Section)
  - **changed**: qty, type, options or scope changed
  - **moved**: an Item in a different Section, or out of order among the Items its Section shares with the base (outside their longest common subsequence, so moving one Item marks only that Item). Likewise for Sections among shared Sections.

  Banner counts add Items and Sections together, and only non-zero ones show.

  An Item can be in several of renamed, changed and moved. Rows in the tables are marked added, changed (including renamed) or moved. The banner expands to list removed Items and Sections, which the tables can't show. Publish has no extra confirm; a "Published" toast follows.
- **Validation at Publish.** Publish is blocked, with the offending rows highlighted and the banner saying what's wrong ("2 Items need a label"), when there are:
  - blank Item labels or Section titles
  - Choice Items with fewer than two options, a blank or duplicate option, or an option over 200 chars (the Check write rules' value limit)
  - more than 500 Items (the Check rules allow 500 responses)

  Empty Sections are allowed: Check entry hides Sections with no due Items.

## Routing

- `/:slug/admin/:applianceId`, `requiresAuth`, case-sensitive like the other slug routes. Its static `admin` segment should outrank the Check route's `/:slug/:applianceId/:sectionId`; confirm that in the router rather than assume it.
- The `admin` appliance id is already shadowed by `/:slug/admin`; the add form and the rules now refuse it rather than relying on a CLI warning.

## Browser Sheets API key

- `make provision` creates a second API key, `appliance-checks-sheets-web`, restricted to the Sheets API and to HTTP referrers `https://<project>.web.app/*` and `https://<project>.firebaseapp.com/*`. On `dev` only, it also allows the Vite dev server's `http://localhost:<port>/*`. It's written to `.env.<env>` as `VITE_SHEETS_API_KEY`, idempotently, like the other provision steps. The key ends up in the bundle by design; the restrictions are its protection. The CLI keeps its own `appliance-checks-sheets-cli` key.
- Local dev reads an optional `VITE_SHEETS_API_KEY` from a gitignored `.env.development.local` (copy the `dev` web key there). `.env.development` stays committed with no key.
- A Cloud Function would keep the key secret, but needs the Blaze plan. A referrer-restricted key that reads public sheets risks only quota, so it isn't worth it now; revisit if #8 moves projects to Blaze and the key causes trouble.

## CLI

- `import-check-sheet` is unchanged, except it prints a note (before the confirm, and on `--dry-run`) when the appliance has a draft: publishing that draft will be refused after this import, and it will need discarding.
- `add-appliance` is unchanged.

## Testing

- **Unit (`tests/domain/`):**
  - Draft ops: add, remove, rename (keeps the id), move within and across Sections, Section add, rename, delete and move, and an op whose target no longer exists is refused.
  - Diff against the base: each of added, removed, renamed, changed, moved for Items and Sections, and edits that net out to nothing.
  - Publish validation: each blocking case above.
  - Fits-its-Item: each input type. An answer that doesn't fit doesn't count towards `isComplete` or `sectionProgress`, and `cellFor` shows it blank.
  - Suggesting an appliance id from a Callsign, and validating it (including `admin`).
  - Pulling a spreadsheet id from a URL or bare id.
  - Copy and Import into a draft: origin handling, and reconciling against the draft vs the current version. `reconcile()` itself is already tested.
- **Rules (`tests/rules/firestore.rules.test.ts`):**
  - Appliance create:
    - allowed for the superadmin and an assigned admin
    - denied for an extra key, a bad id, `admin`, `active: false`, a non-null pointer, an unassigned admin, and anonymous
  - Appliance update: Callsign and Active changes allowed; other keys, a pointer jump of more than 1, and a pointer move without the version doc are denied.
  - Version create: allowed with the pointer move in the same batch; denied alone, with a mismatched id, or a bad origin. Update and delete are denied.
  - Draft: an assigned admin can read and write; anonymous and unassigned admins can't; other `private` docs stay denied.
- **E2E (Playwright; `sheets.googleapis.com` intercepted with a fixture grid, so no real sheet or key):**
  1. Add an appliance, import a sheet, Publish, then open its QR link and see its Sections.
  2. Answer an Item mid-Check, rename it and delete another, Publish: the rename keeps its answer, and the deleted Item is gone.
  3. Complete a Check, then edit and Publish: that Check still renders its old sheet and stays Complete.
  4. Edits survive a reload, and Discard reverts them.
  5. Drag an Item into another Section and Publish: Check entry shows it in the new Section.
  6. Copy from another appliance, and Publish.
  7. Deactivate an appliance: it drops off the Brigade Link list. Reactivate it.
  - The existing Monthly Report specs need updating for the reorganised brigade admin page.
- Not unit-tested: the Firestore data wrappers and the provision step, consistent with earlier slices. They're covered by e2e and a manual run.

## Doc changes

- `CONTEXT.md`:
  - Add **Draft**: "Unpublished edits to an Appliance's Check Sheet. Checks don't see them until they're Published." _Avoid_: pending version.
  - Add to **Complete**: an answer only counts if it fits its Item.
- ADR 0003: versions are created on Publish (or import), not on every edit.
- New ADR 0006, "Check Sheet edits are drafted and published as one version": the reasoning above, with the rejected options. Those are a version per edit (versions lose meaning, edits go live unreviewed), and editing a version in place until a Check uses it (edits go live instantly, and immutability rests on a client-side query racing anonymous Check writes).
- ADR 0005: soften "Worth re-running the check before #7 gives admins writes" to re-running it if Firebase's sign-in behaviour is suspected to have changed (it was re-run in October 2026).
- `docs/designs/2026-09-26-check-entry-design.md`: the Completeness bullets gain the fits-its-Item rule, pointing here.
- `docs/infra-setup.md`: the browser key, its referrers, and `.env.development.local`.
- `README.md`: the admin section covers the brigade admin page, the appliance page and import in the UI. The CLI import and add-appliance stay documented as alternatives.
- Issue #7: update the scope (admin writes via `isBrigadeAdmin`, appliance add/rename/deactivate, UI import) and done-when ("a version is created on Publish"; "edits save eagerly to a draft").

## Changes during implementation

- **Drag and drop uses `vue-draggable-plus`** rather than `vuedraggable` (unmaintained since 2021). Same SortableJS underneath.
- **"Moved" is the minimal set** (longest common subsequence), and banner counts combine Items and Sections. The design didn't pin either down.
- **Switching an Item away from Choice drops its options**, and switching to Choice starts with none, so a draft that's been switched back compares equal to its base. Choice → Y/N → Choice loses the list; Discard is the only way back.
- **Copy and Import re-draw repeated ids** after `reconcile()`, which maps every same-label Item onto one existing id. The editor doesn't forbid duplicate labels, so copying such a sheet would otherwise give two Items one id.
- **The import field takes the first import origin of the draft and the current version**, rather than the draft's alone.
- **An Import or Copy that nets out to the base deletes the draft** like any other edit, so the UI can't re-point an unchanged sheet at a different spreadsheet (the CLI still can).
- **A missing browser key isn't checked up front**: the request goes out with an empty key and Google's error shows inline, as any Sheets API error does. This also lets e2e stub the Sheets API without a key.
- **The CLI's draft note prints before the confirm** (and on `--dry-run`), so it can inform the decision.
- **The editor shows each edit straight away** and swaps in the committed draft once its queue drains, so typing isn't held up by round trips.
- **New rows and Sections are local until their first committed field.** A new Section has no "+ Item" until its title is committed, and a new row can't be dragged or deleted until then. Enter in any text cell of a table's last row adds a row.
- **Rules tests** gained a case for a stray version doc alongside a valid Publish (the id clause on its own); the editor's e2e specs run against their own seeded brigade (`e2eedt`), plus an eighth spec for add, Undo, Alt+↑ and a Publish blocked by problems.
- **Checks that were Complete only through an answer that no longer fits** (possible for data written before this change, because answering or opting in re-stamps a Check) are no longer Complete, so an in-window one can unfreeze and follow the latest sheet. New data can't get into that state; worth a query for in-window Checks before deploying.
- **Verified on `dev`** (October 2026): `make provision` created the browser key, and importing a Google Sheet on the deployed site works.
- **Open follow-ups:**
  - Discard deletes whatever draft exists without checking its base, so it could discard another admin's newer draft. Arguably fine for one shared draft (#19).
  - A text cell whose Enter-commit fails keeps the typed value while focused, and re-sends it on blur (#19).
  - Undo into a Section deleted since shows the generic "Couldn't save" (#19).
  - Re-running `make provision` doesn't update an existing browser key's referrers, and only Vite's default port 5173 is allowed on `dev` (#20).

## Out of scope

Role-aware navigation and gates (#12); deleting appliances or changing their ids; live sync between admins editing at once; server-side import; generating QR code images; a version history or restore UI; validating Item contents in rules.

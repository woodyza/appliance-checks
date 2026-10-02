# Check Sheet edits are drafted and published as one version

The Check Sheet editor saves each edit to one shared draft per appliance (`private/checkSheetDraft`, admins only), and **Publish** turns the draft into one new version (ADR 0003): in a single transaction it creates `checkSheetVersions/{n+1}`, moves the pointer and deletes the draft. Admins never see version numbers.

Edits are id-based operations (set a field on an Item, add, remove, move), each applied to the draft in a transaction, so two admins editing different Items don't overwrite each other. An edit is refused, and the page reloads, if it was made against a base the admin wasn't looking at: the draft was published or discarded by someone else, or the appliance's current version moved.

This keeps edits from being lost, because they save as they're made. It keeps half-finished edits away from Checks that aren't Frozen, which follow the latest version (ADR 0002). And it keeps one version per deliberate set of changes, so a version means something.

## Considered Options

- **A version per edit**: no draft, but one rename becomes a version, so versions stop meaning anything, and a half-finished edit reaches Checks in progress straight away.
- **Edit the current version in place until a Check uses it**: no draft doc, but edits go live instantly, and immutability would rest on a client-side "has a Check used it?" query racing anonymous Check writes.
- **A shared draft, published as one version (chosen)**.

## Consequences

- The draft is its own doc, so anonymous Check entry, which lists appliances on every visit, doesn't load a whole sheet per appliance, and unpublished edits aren't anonymously readable.
- There's one draft per appliance, shared by every admin. There are no per-admin drafts.
- A CLI import moves the pointer without touching the draft, so Publishing that draft is then refused and it has to be discarded. The CLI prints a note when a draft exists.
- There's no live sync: a screen re-renders from the committed draft after each of its own edits.
- The rules can't iterate a list, so they check the shape of versions and drafts but not Items. The client enforces Item contents when Publishing.

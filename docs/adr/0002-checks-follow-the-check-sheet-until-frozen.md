# Checks follow the Check Sheet until Frozen

There's no explicit "mark complete" step, so a Check follows the latest version of its Check Sheet until it's Frozen, meaning Complete or past its window. After that it keeps the version it was answered against. Freezing only pins the Check Sheet version: a Frozen Check's answers stay editable. So Check Sheet edits reach Checks that are still in progress, but don't rewrite history, and past Monthly Reports stay stable. Items have stable ids, so an edit keeps answers for Items that still exist, and answers for removed Items are dropped. A person can still opt a Frozen Check in to the latest Check Sheet (and re-run that month's report) to handle process edge cases. It never happens automatically, so immutability is the norm rather than a guarantee.

## Considered Options

- **Always render against the current Check Sheet**: simplest, but a single edit would silently rewrite every past Check and Monthly Report.
- **Freeze on creation**: history is stable, but a Check that's half done when an Item is added never gets that Item.

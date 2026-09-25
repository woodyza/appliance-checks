# Check Sheet versions are immutable snapshots

Each `checkSheetVersions/{n}` document is a full, self-contained copy of every Section and Item, not a diff against the previous version. A new version is never edited once written; importing or editing a Check Sheet always creates version `n+1` and moves the appliance's `currentCheckSheetVersion` pointer to it in the same transaction.

This is what lets a Check reference a specific version and stay stable (ADR 0002: Checks follow the Check Sheet until Frozen): reading `checkSheetVersions/{n}` always returns exactly what was in force at that time, with no risk of a later edit reaching back into it.

## Consequences

- Storage grows with every edit, but Check Sheets change rarely and each version is small, so this is not a practical concern.
- There is no separate "history" or "diff" feature to build: the version list already is the history, and the import report (matched/changed/added/removed) is derived by comparing two versions' Sections and Items at import time, not stored.

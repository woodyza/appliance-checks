## Agent skills

### Issue tracker

GitHub Issues on `woodyza/appliance-checks`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Running things

`make check` is the full check (lint, typecheck, unit and emulator tests) and needs port 8080 free, so stop `make dev` first. `make e2e` is kept out of it and reuses a running `make dev`. Commit as `woody <woody.za@gmail.com>`; on a fresh clone, set it in the repo's local git config first.

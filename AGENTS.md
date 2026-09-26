## Agent skills

### Issue tracker

GitHub Issues on `woodyza/appliance-checks`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Designs and plans

Each slice of #1 gets a design in `docs/designs/<date>-<topic>-design.md` (updated to what shipped) and an implementation plan in `docs/plans/impl/<topic>.md`, whose Decisions section records deviations and why. Read the ones a new slice builds on: #6 reads Checks and Check Sheet versions as defined in the check entry design, and should reuse `src/domain/check.ts` for completeness. Environment setup and what's been verified on `dev` are in `docs/infra-setup.md`.

### Running things

`make check` is the full check (lint, typecheck, unit and emulator tests) and needs port 8080 free, so stop `make dev` first. `make e2e` is kept out of it and reuses a running `make dev`. Commit as `woody <woody.za@gmail.com>`; on a fresh clone, set it in the repo's local git config first.

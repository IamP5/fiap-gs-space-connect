# Clean State Checklist

Run this before you end a session. A clean state is part of the **definition of done**,
not optional housekeeping — the next session is here to do new work, not to figure out and
repair what the last one left behind. "Clean up later" means never.

## Exit gate (every session)

- [ ] **Build is green** — `go build ./...` compiles clean (and `cd web && npm run build` if web changed).
- [ ] **Tests pass** — `go test -race ./...` (and `cd web && npm test` if web changed), including pre-existing tests. No functionality left broken.
- [ ] **Lint is clean** — `make lint` reports 0 issues.
- [ ] **`feature_list.json` reflects reality** — statuses match what actually passes vs. what is only written; no feature marked `passing` without evidence.
- [ ] **`PROGRESS.md` updated** — current verified state + a session-log entry (completed, verification run, evidence, next best step).
- [ ] **No stale artifacts** — no leftover debug prints, commented-out code, scratch files, or `TODO`/`FIXME` markers introduced this session. (`git status` is clean of junk; coverage.out and temp files removed.)
- [ ] **Standard startup path still works** — `./init.sh` runs to a green baseline from a clean checkout.
- [ ] **Committed in a safe state** — work is committed (Conventional Commits) so the next session can resume from `./init.sh` without manual repair.
- [ ] **Blockers documented** — anything unresolved is written down in `PROGRESS.md` / `session-handoff.md`, not left in your head.

The fast way to satisfy the first four mechanically:

```sh
./init.sh            # build + vet + lint + race tests (add WEB=1 for the dashboard)
git status           # confirm no stray debug/scratch files
```

## Idempotent cleanup (safe to re-run)

```sh
rm -f coverage.out
git restore --staged . 2>/dev/null || true   # only if you staged something by mistake
```

> If the baseline was **already** red when you arrived, fixing that is the first feature —
> don't stack new work on a broken base (see `AGENTS.md` → Startup Workflow).

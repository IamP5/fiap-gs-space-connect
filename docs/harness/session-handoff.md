# Session Handoff

Compact context transfer for the next session. **Overwrite this each time** — it is a
snapshot of the latest handoff, not a log (the log is `PROGRESS.md`). Fill it in at the end
of a substantial session, in addition to updating `PROGRESS.md` and `feature_list.json`.

> _Template below. Replace the italic prompts with the current handoff._

## Verified Now
- **What is currently working:** _e.g. backend baseline green @ <commit>; MVP demo closes the dome._
- **What verification actually ran:** _e.g. `make check` exit 0; `./deploy/k8s/up.sh` pass._

## Changed This Session
- **Code or behavior added:** _…_
- **Harness / infra changes:** _…_

## Broken Or Unverified
- **Known defect:** _… or "none"._
- **Unverified path:** _e.g. web baseline not re-run; k8s e2e not re-run._
- **Risk for the next session:** _…_

## Next Best Step
- **Highest-priority unfinished feature:** _id + title from `feature_list.json` (e.g. `bh-01`)._
- **Why it is next:** _dependency order / priority._
- **What counts as passing:** _the verification that must run._
- **What must NOT change during that step:** _e.g. the award/lease/expiry path; CONTEXT.md vocabulary; ADR decisions._

## Commands
- **Startup:** `./init.sh`
- **Verification:** `make check` (backend) · `WEB=1 ./init.sh` (web) · `./deploy/k8s/up.sh` (e2e)
- **Focused debug:** _e.g. `go test -race ./internal/coordinator/ -run TestExpiry`_

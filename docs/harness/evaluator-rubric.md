# Evaluator Rubric

Use this rubric **after implementation and before final acceptance** of a session's work.
Its purpose is to replace the agent's own (systematically over-confident) self-assessment
with an evidence-based score from a separate "checker" pass — the person/agent who *checks*
the work is not the one who *did* it.

Score each category 0–2 (0 = absent, 1 = partial, 2 = solid). Cite the evidence; a score
without evidence is itself a finding.

| Category | Question | Score (0-2) | Notes / evidence |
|---|---|---|---|
| **Correctness** | Does the implemented behavior match the feature's `user_visible_behavior` in `feature_list.json`? | | |
| **Verification** | Did the required checks actually run (not just "code looks right"), with recorded evidence — `make check`, web build/test, and `./deploy/k8s/up.sh` where the change crosses components? | | |
| **Scope discipline** | Did the session stay inside the one active feature (WIP=1)? No opportunistic "while I'm here" refactors or parallel features? | | |
| **Domain fidelity** | Does the code/commit use `CONTEXT.md` vocabulary exactly and respect the relevant ADRs (esp. the invariant: no harness call on the award/lease/expiry path)? | | |
| **Reliability** | Does the result survive a restart/rerun without manual repair (`./init.sh` green from a clean checkout)? | | |
| **Maintainability** | Is the code idiomatic (matches the `golang-*` / `vercel-*` skills), tested table-driven, and clear enough for the next session? | | |
| **Handoff readiness** | Can a fresh session continue from repo artifacts alone — `feature_list.json`, `PROGRESS.md`, ADRs — with no chat history? | | |

**Total:** ___ / 14

## Verdict

- [ ] **Accept** (≥12 and no category at 0)
- [ ] **Revise** (gaps are addressable this session)
- [ ] **Block** (correctness or verification at 0 — do not mark the feature `passing`)

## Required Follow-Up
- **Missing evidence:** _…_
- **Required fixes:** _…_
- **Next review trigger:** _…_

> **End-to-end is non-negotiable for cross-component work.** Unit tests passing ≠ feature
> complete: isolated tests are designed in a way that structurally cannot catch interface,
> state-propagation, or error-propagation defects across the core → bus → gateway → screen
> seam. When a change crosses components, `./deploy/k8s/up.sh` must be part of the evidence.

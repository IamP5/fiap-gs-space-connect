# Issue tracking & labels

How GitHub issues, PRs, and the in-repo issue docs stay in sync. The goal: a
contributor or agent never has to guess which label to use, and **no issue is
left "merged-but-open"** the way #47–#61 were (PRs referenced them only in the
title, so GitHub never auto-closed them).

## Grouping: GitHub milestones (default)

Large initiatives are grouped with a **GitHub milestone**, not a tracking issue.
Create the milestone (title `NN — Initiative Name`, matching the
`docs/NN-name/` folder), then file each vertical slice as a `type:feature` /
`type:task` issue **assigned to that milestone**. The milestone's own progress bar
is the "checklist"; the `docs/NN-name/` README carries the human-readable slice
checklist.

> **Retired:** the old `type:epic` *tracking issue* (e.g. #46, #62) is no longer
> created for new initiatives — use a milestone. The `type:epic` label and those
> historical issues stay as-is; don't delete them. Legacy `feature_list.json`
> entries keep their `epic` field; new entries carry `milestone` instead (see
> "The three trackers").

## Label vocabulary

Every issue carries **exactly one `type:` + one `area:`** label.

### `type:` — what kind of work it is

| Label | Use for | Colour |
|-------|---------|--------|
| `type:feature` | A user-facing capability or visible behaviour — a vertical slice that delivers something demoable. | green |
| `type:task` | A small standalone task / chore that isn't a user-facing feature (tooling, deps, config, a focused internal change). | pale blue |
| `type:bug` | Something is broken vs. intended behaviour. | red |
| `type:refactor` | Code change with **no** behaviour change. | yellow |
| `type:epic` | **Legacy / retired** — grouping now uses milestones. Kept only for the historical epic issues (#46, #62); do not apply to new issues. | purple |

Rule of thumb: **feature** = one demoable slice ·
**task** = a chore no user would notice · **refactor** = same behaviour, cleaner code ·
**bug** = a defect. (Grouping many slices = a **milestone**, not a label.)

### `area:` — where it lives

`area:frontend` (web / renderer / UI) · `area:backend` (Go core, coordinator, NATS,
harness) · `area:docs` · `area:infra` (containers, k8s, CI, deploy).

## PR → issue linking (the rule)

The fix for the merged-but-open gap is a **convention** backed by a **safety-net Action**.

1. **Put the delivered issue number in the PR title:** `type(scope): subject (#NN)`
   (e.g. `feat(scene): sky bodies (#51)`). The title number is treated as the
   issue this PR delivers.
2. **Also add `Closes #NN` in the PR body** (the template has the line). GitHub
   auto-closes it on merge to `main`. Use `Refs #NN` for partial progress.
3. **Links that must NOT close:** `Relates #NN`, `Blocked by #NN`, `Parent #NN`,
   `Epic #NN`, `See #NN`. These are dependencies/cross-refs only. (Milestone
   membership groups a slice but never closes it — set it via the issue's
   milestone field, not a body link.)

### Safety net: `.github/workflows/issue-sync.yml`

On every **merged** PR it parses the title + body and closes the delivered
issue(s) — even if the author forgot `Closes #NN` and only had `feat(#NN)` /
`(#NN)` in the title. It skips reference-only links (Relates / Blocked by /
Refs / Parent / Epic) and anything already closed. It never fails the build
(a read-only fork token just logs a warning).

So in practice: **just put `(#NN)` in the title and you're covered**; the
`Closes #NN` body line is the explicit, GitHub-native belt to the Action's braces.

## The three trackers (and the round-trip)

Work is tracked in three places that must agree. Each owns a different thing:

| Tracker | Owns | Source of truth for |
|---------|------|---------------------|
| **GitHub issue** | open/closed state, labels, discussion | *state* |
| **`feature_list.json`** | the harness scheduler's view (status, priority, `depends_on`, evidence) | *machine status the agent acts on* |
| **`docs/<NN-name>/` README checklist** | the full intent/detail of each slice | *intent / detail* |

**The join key:** every tracker-mapped feature in `feature_list.json` carries
`issue` (GitHub #) and `milestone` (GitHub milestone #), and its `id` is
`r3d-<issue>` (so `r3d-83` ⇄ issue #83). `feature.status` and the GitHub issue
state must agree: **`passing` ⇔ closed**, anything else ⇔ open. *(Legacy
pre-2026-06 features carry `epic` = the retired tracking-issue # instead of
`milestone`.)*

### The merge round-trip (what must happen together)

When a PR that delivers an issue merges to `main`:

1. **GitHub issue → closed** — automatic: GitHub (`Closes #NN` in the body) and/or
   the `issue-sync` Action (title `(#NN)`). *(automatic)*
2. **`feature_list.json` → `passing`** with evidence (the PR # + baseline result)
   — done **in the same PR**, per the End-of-session routine in `AGENTS.md`.
3. **Milestone docs checklist → ticked** (`- [x] #NN … · PR #MM`) in the
   `docs/<NN-name>/` README — also **in the same PR**.

Steps 2–3 are documented PR steps, not automated edits — markdown checklists and
evidence prose are easy to get wrong programmatically, and doing them in the PR
keeps intent and code together. We deliberately do **not** add a CI guard for
drift (kept lightweight); the PR checklist is the gate. If you ever find the
trackers disagree (e.g. a `passing` feature whose issue is still open), fix it the
same way we reconciled #47–#61: close the issue with a "Landed in PR #NN" note and
flip/annotate the feature.

New child slices created via `/to-issues` should be added to **all three**: the
GitHub issue (with labels, **assigned to the milestone**), a `feature_list.json`
entry (`r3d-<issue>`, usually `not_started` with `depends_on` + `milestone`), and
the `docs/<NN-name>/` README checklist.

## Creating issues

The `/to-issues` skill drafts vertical slices and publishes them with the right
`type:` + `area:` labels, **assigned to the initiative's GitHub milestone**, in
dependency order. Create the milestone first (`NN — Initiative Name`), then the
slices. New child slices should also be appended to the `docs/<NN-name>/` README
checklist.

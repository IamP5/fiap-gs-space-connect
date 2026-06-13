<!-- Title convention: `type(scope): subject (#NN)` — put the delivered issue # in the title. -->

## Summary

<!-- What changed and why. Keep it tight. -->

## Issue

Closes #<!-- NN -->
<!--
  Use `Closes #NN` for the issue this PR FULLY delivers (auto-closes on merge).
  Use `Refs #NN` for partial progress (will NOT close).
  `Relates #NN` / `Blocked by #NN` are links only — never auto-close.
-->

## Labels

Pick exactly one **type** + one **area** (see docs/harness/issue-tracking.md):

- type: `type:epic` · `type:feature` · `type:task` · `type:bug` · `type:refactor`
- area: `area:frontend` · `area:backend` · `area:docs` · `area:infra`

## Checklist

- [ ] Definition of Done met (build + lint + tests; `./deploy/k8s/up.sh` if the change crosses components)
- [ ] `feature_list.json` / `PROGRESS.md` updated
- [ ] If this closes an epic child, ticked its box in `docs/<epic>/issues/<NN>-*.md` **and** the epic's child checklist
- [ ] New textured/glTF assets have a primitive fallback + `CREDITS.md` entry (renderer work)

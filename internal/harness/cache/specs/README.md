# Baked Build specs

Committed, embedded Build specs (TECHSPEC §4, ADR-0007/0008):

- `{blueprintId}_{taskId}_{contractHash}_{model}.json` — the approved Build spec
  (declarative geometry the replay path renders).

These specs are declarative geometry DATA, not secrets — they let placements
replay generated specs deterministically with no API key and no model call. The
embedded cache (`embed.go`) loads only the spec `*.json` files; it skips this
README. A Task with no committed spec falls back to the deterministic primitive
op stream, so a placement always completes.

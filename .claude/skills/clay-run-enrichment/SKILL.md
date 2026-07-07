---
name: clay-run-enrichment
description: Run a small sample through Clay enrichment columns and verify the results - use when you need to fire an action on rows (credit-consuming), watch a run to completion, or read back and score a table before deciding whether to scale.
---

# clay-run-enrichment

`run-top` spends Clay credits - it is the only command in this package in the
`CREDIT` set as well as `MUTATING`. Always sample small, always read back before
deciding to scale.

## Running a sample

```bash
node clay-v2.js run-top t_TEST_TABLE --field f_TEST_FIELD --view gv_TEST_VIEW --n 10 --confirm
```

- `--n` defaults to 10 and the CLI **refuses anything above 10** unless you also pass
  `--allow-more-than-10`. Do not reach for that flag to skip the sample-first workflow
  - keep first runs at 10 rows or fewer, read back, then decide.
- Requires exact chat confirmation of this literal command (table, field, view, n) -
  never approve a "run it" without the specific IDs in front of you.

## Watching and checking status

```bash
node clay-v2.js run-watch t_TEST_TABLE --field f_TEST_FIELD --timeout 300 --interval 5
node clay-v2.js run-status t_TEST_TABLE --workspace {{workspace_id}}
```

- `run-watch` polls until the field finishes or the timeout elapses (default 300s,
  poll every 5s by default). Both are read-only.

## Readback and verification

```bash
node clay-v2.js verify-table t_TEST_TABLE --view gv_TEST_VIEW --include-rows 10 --require-values f_email,f_status
node clay-v2.js proof-readback t_TEST_TABLE --view gv_TEST_VIEW --field f_TEST_FIELD --include-rows 10
```

- `verify-table --require-values` fails if any of the named fields are empty across
  the sampled rows - use it as your first readback gate after a `run-top`.
- `proof-readback` is hard-capped at 10 rows (`--include-rows` cannot exceed it) and
  accepts `--expected-enums-json '{...}'` to check enum-typed outputs against an
  expected set. It also supports a fully offline mode via `--from-manifest
  manifest.json` if you already pulled a manifest with `/clay-explore`.

## Redaction and parity scoring (offline)

```bash
node clay-v2.js redact manifest.json --report redact-report.json
node clay-v2.js score before-manifest.json after-manifest.json
```

- `redact` strips sensitive keys/values from any exported JSON down to
  `<redacted:...>` stubs, useful before sharing a manifest for review.
- `score` compares field-config parity between two manifests (e.g. a spec's expected
  shape vs the live table) - both are fully offline, no session required.

## How this fits the bigger loop

For anything beyond a one-off sample, `/clay-run-playbook` wraps this exact
sample -> readback -> evidence -> quality-report -> scale-gate sequence with explicit
confirmation gates at each step. Reach for this skill directly when you just need one
sample run and a readback; reach for `/clay-run-playbook` when you're running a
full playbook end to end.

## Gotchas

- `run-top` and `run-status`/`run-watch` all need a valid session - see
  `/clay-onboarding` if you get a session-expired error mid-run.
- `verify-table` and `proof-readback` are read-only but still Clay-scoped: they need
  the same session as everything else, they just never mutate.

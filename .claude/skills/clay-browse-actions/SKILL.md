---
name: clay-browse-actions
description: Discover Clay actions and manage the local action catalog - use when searching for an available action/integration, checking catalog coverage against the strict proof registry, classifying action safety, or generating action templates.
---

# clay-browse-actions

These commands work against a locally-held action catalog (a JSON dump of Clay's
action types) plus, for some, an `integration-library/registry.yaml` that curates
which actions are "proven safe" to reuse. Most are offline once you have a catalog
file; discovery against live Clay needs a session.

## Discovery against live Clay

```bash
node clay-v2.js search-actions "email finder" --workspace {{workspace_id}}
node clay-v2.js actions-catalog --workspace {{workspace_id}} --query "linkedin"
```

- `search-actions` defaults to searching across 12 action types; narrow with
  `--types t1,t2`.
- `actions-catalog --report file` writes the full catalog dump to a file for the
  offline commands below to consume.

## Normalizing and diffing a catalog dump (offline)

```bash
node clay-v2.js normalize-actions-catalog actions-catalog.raw.json --out actions-catalog.normalized.json
node clay-v2.js catalog-delta stored-catalog.json new-catalog.json --out delta-report.json
# equivalent standalone form:
node lib/catalog-delta.js stored-catalog.json new-catalog.json --out delta-report.json
```

## Coverage, safety, and promotion tooling (offline, standalone scripts)

```bash
node lib/catalog-coverage-dashboard.js --raw actions-catalog.raw.json --strict-registry integration-library/registry.yaml --md coverage.md --limit 25
node lib/safety-classifier.js --input actions-catalog.raw.json --output classifications.json --per-action
node lib/proof-strategy-classifier.js actions-catalog.raw.json proof-strategies.json
node lib/action-template-generator.js actions-catalog.raw.json --query "email" --limit 10 --format yaml --out templates.yaml
node lib/blocked-action-report.js --catalog actions-catalog.raw.json --json-out blocked.json --md-out blocked.md
node lib/merge-catalog-shards.js --raw actions-catalog.raw.json --shards shards-dir --out merged.json --dashboard dashboard.md
node lib/catalog-promotion-guard.js propose --catalog actions-catalog.raw.json --registry integration-library/registry.yaml --key example-action-key --proof proof.json --out registry.yaml
node lib/catalog-promotion-guard.js promote --catalog actions-catalog.raw.json --registry integration-library/registry.yaml --key example-action-key --proof proof.json --out registry.yaml
```

- `catalog-coverage-dashboard.js` compares the raw catalog against the strict proof
  registry and shows what's covered vs missing.
- `catalog-promotion-guard.js propose|promote` is how an action key moves into the
  strict registry once you have proof it works - `propose` stages it, `promote`
  commits it.
- `merge-catalog-shards.js` merges parallel discovery shard outputs (e.g. from a
  Sandcastle-style parallel discovery run) into one catalog file.

## Refreshing an integration library from live discovery

```bash
node clay-v2.js onboard-workspace --workspace {{workspace_id}} --workbooks wb_a,wb_b --limit 20 --update-library --out-dir onboard-output
```

Read-only against Clay (it writes local artifacts, never mutates the workspace), but
requires `--update-library` to also touch the local integration library files.

## The shipped integration registry

`integration-library/registry.yaml` ships with 40 Clay actions (plus per-action
templates in `integration-library/templates/`), each with observed input bindings,
status semantics, and a battle-test verdict. Observation evidence is intentionally
not included in the public build - validate anything you rely on with a <=10-row
sandbox run in your own workspace. If you ever hit ENOENT on
`integration-library/registry.yaml`, your checkout is incomplete - re-clone rather
than hand-creating the file.

```bash
node clay-v2.js integration-list --out integrations.json
node clay-v2.js integration-show example-action-key --out integration.json
node clay-v2.js integration-promotion-report --format markdown --out promotion-report.md
node clay-v2.js integration-validate-spec table.yaml --out validation.json
```

## Gotchas

- Every command in this skill is read-only or fully offline - none need `--confirm`.
- `action-template-generator.js` and `catalog-promotion-guard.js` both work off
  whatever catalog file you point them at - keep raw and normalized catalog files
  separate so you don't feed a normalized file where a raw one is expected (check
  each script's own usage string if unsure).
- `generate-package-playbooks.js` and `package-rollup-report.js` (per-package catalog
  rollups) default to a repo-relative `runs/2026-06-09/...` path that simply won't
  exist on a fresh clone - pass `--catalog`/`--input` explicitly rather than relying
  on the default.

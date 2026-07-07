---
name: clay-explore
description: Read-only exploration of Clay tables, workbooks, sources, and workspace metadata - use when you need to understand a table's shape, check run status, list workspaces/tables, or pull credit usage without changing anything.
---

# clay-explore

Every command here is read-only against Clay - none require `--confirm` and none touch
`MUTATING`/`CREDIT` sets. Good first stop before building or running anything. Requires
a valid session (`/clay-onboarding`).

## Table and workbook inspection (clay-v2.js)

```bash
node clay-v2.js manifest t_TEST_TABLE --view gv_TEST_VIEW --include-rows 10
node clay-v2.js workbook-fixture wb_TEST_WORKBOOK
node clay-v2.js workbook-export wb_TEST_WORKBOOK --include-rows 20 --template-out table.yaml
node clay-v2.js sources t_TEST_TABLE
node clay-v2.js action-def t_TEST_TABLE f_TEST_FIELD
node clay-v2.js verify-table t_TEST_TABLE --view gv_TEST_VIEW --include-rows 10 --require-values f_email,f_phone
node clay-v2.js run-status t_TEST_TABLE --workspace {{workspace_id}}
node clay-v2.js app-accounts --workspace {{workspace_id}} --type appAccountTypeId
node clay-v2.js model-pricing --workspace {{workspace_id}}
```

- `manifest` is the single most useful command for understanding a table: fields,
  types, view config, and (with `--include-rows`) a sample of rows.
- `workbook-export --template-out file` is a good pairing with `/clay-export` - it also
  writes a spec-shaped template you can feed into `export-spec`/`apply-spec` workflows.
- `verify-table --require-values` fails loudly if named fields are empty on sampled
  rows - use it as a cheap readback check (also covered in `/clay-run-enrichment`).
- `run-status` reports current run state on a table; see `/clay-run-enrichment` for the
  blocking `run-watch` variant.

## Workspace-level reads (clay-api.js)

```bash
node clay-api.js workspaces
node clay-api.js tables {{workspace_id}}
node clay-api.js table-info t_TEST_TABLE
node clay-api.js rows t_TEST_TABLE gv_TEST_VIEW 20 0
node clay-api.js record t_TEST_TABLE r_TEST_RECORD
node clay-api.js credits {{workspace_id}}
node clay-api.js credits-by-integration {{workspace_id}}
node clay-api.js permissions {{workspace_id}}
node clay-api.js signals {{workspace_id}}
```

- `credits` / `credits-by-integration` accept optional `[start] [end]` date args for a
  window; omit them for an all-time view.
- `rows <tableId> <viewId> [limit] [offset]` is the raw paginated row reader - prefer
  `manifest --include-rows` when you also want field/view metadata in one call.
- `clay-api.js` has **no redaction layer** (unlike `clay-v2.js`). Its output can contain
  real emails, phones, and IDs - never paste raw `clay-api.js` output into a public
  channel, issue, or PR. If you need to share what you found, run the same lookup
  through a `clay-v2.js` equivalent (which redacts by default) or hand-redact first.

## Gotchas

- `clay-api.js`'s own help header prints `node clay-skills/clay-api.js` as the
  invocation - that path doesn't exist in this package; the file is at the repo root,
  so always run it as `node clay-api.js ...`.
- `manifest`/`workbook-fixture`/`workbook-export` all accept `--out file` to write JSON
  instead of printing - useful when piping into `/clay-build-table` spec commands.
- None of these commands need `--confirm`; if you see a safety-notice error asking for
  it, you've mistyped a command name - check `node clay-v2.js help`.

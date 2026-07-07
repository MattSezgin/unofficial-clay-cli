---
name: clay-build-table
description: Build and modify Clay tables, views, fields, and records with clay-v2.js - use when creating a new table/workbook, adding or editing columns (text/formula/http-api/use-ai/action), managing views, or writing declarative table specs.
---

# clay-build-table

Every command in this skill is mutating and requires **exact chat confirmation before
you ever pass `--confirm`**. The operator must approve the literal command (table ID,
field name, flags and all) before it runs live - never batch several `--confirm` calls
behind one "go ahead". Where a command supports `--dry-run` (`apply-spec`,
`create-field`, `create-action`, `update-field`), show that offline preview first.
Most direct field/table/view/record commands below have no `--dry-run` mode at all -
for those, write out the exact live command with real values and get it approved in
chat before adding `--confirm`, rather than running it speculatively.

## Declarative spec workflow (preferred for anything non-trivial)

```bash
node clay-v2.js export-spec t_TEST_TABLE --view gv_TEST_VIEW --out table.yaml
node clay-v2.js validate-spec table.yaml
node clay-v2.js diff-spec table.yaml --table t_TEST_TABLE --view gv_TEST_VIEW
node clay-v2.js apply-spec table.yaml --dry-run
# after chat confirmation of the exact command above's live equivalent:
node clay-v2.js apply-spec table.yaml --workspace {{workspace_id}} --confirm
```

- `export-spec` snapshots an existing table's shape into a spec you can diff or reuse.
- `validate-spec` is fully offline - safe to run any time.
- `apply-spec --dry-run` produces an offline plan (creates/patches table, view, fields,
  outputs, rows as needed) with no live effect - this is what you show the operator
  before asking for the real `--confirm` run.
- `apply-spec` resolves `${ENV}` placeholders in the spec at apply time.

## Direct field/table/view commands

```bash
# workbook / table
node clay-v2.js create-workbook --name "My Workbook" --workspace {{workspace_id}} --confirm
node clay-v2.js create-table --workbook wb_TEST_WORKBOOK --name "My Table" --confirm
node clay-v2.js update-table-settings t_TEST_TABLE --auto-run true --confirm

# views
node clay-v2.js create-view t_TEST_TABLE --name "My View" --confirm
node clay-v2.js update-view t_TEST_TABLE --view gv_TEST_VIEW --name "Renamed" --confirm
node clay-v2.js delete-view t_TEST_TABLE --view gv_TEST_VIEW --confirm
node clay-v2.js view-field t_TEST_TABLE --view gv_TEST_VIEW --field f_TEST_FIELD --visible true --confirm
```

## Field types (`create-field`)

```bash
# text (default type)
node clay-v2.js create-field t_TEST_TABLE --name "Notes" --type text --confirm

# formula
node clay-v2.js create-field t_TEST_TABLE --name "Full Name" --type formula \
  --formula "CONCAT({{first_name}}, ' ', {{last_name}})" --confirm

# http-api
node clay-v2.js create-field t_TEST_TABLE --name "Lookup" --type http-api \
  --url "https://api.example.com/lookup" --method GET --confirm

# use-ai
node clay-v2.js create-field t_TEST_TABLE --name "Classify" --type use-ai \
  --prompt "Classify this company by industry." \
  --outputs industry:text:industry --model gpt-4o-mini --dry-run
```

- Always preview a `use-ai` field with `--dry-run` first - it's an offline preview mode
  distinct from the mutating create.
- `use-ai` fields warn loudly if `--auth-account aa_xxx` is missing - pass a real auth
  account ID for anything that needs one, or expect the warning.
- `create-action` needs `--name`, `--action-key`, `--package-id` (all required); use
  `--field-map-json` only with `--dry-run` (dry-run-only flag).

```bash
node clay-v2.js update-field t_TEST_TABLE --field f_TEST_FIELD --name "New Name" --confirm
node clay-v2.js delete-field t_TEST_TABLE --field f_TEST_FIELD --confirm
node clay-v2.js create-field-group t_TEST_TABLE --name "Group" --fields f_a,f_b --confirm
node clay-v2.js create-output-field t_TEST_TABLE --parent f_TEST_FIELD --name "City" --path city --confirm
node clay-v2.js verify-field-output-schema t_TEST_TABLE --field f_TEST_FIELD --outputs city:text:city
```

`verify-field-output-schema` is read-only and also accepts `--from-manifest
manifest.json` for a fully offline check.

## Records

```bash
echo '[{"Email":"jane@example.com"}]' | node clay-v2.js add-rows t_TEST_TABLE --confirm
node clay-v2.js update-record t_TEST_TABLE --record r_TEST_RECORD --cells '{"Status":"Reviewed"}' --confirm
node clay-v2.js delete-record t_TEST_TABLE --record r_TEST_RECORD --confirm
```

- `update-record --cells` takes field **names**, resolved to IDs internally.
- Writing to a select-type cell is blocked by default; pass `--allow-select-write`
  only when you mean it.
- `add-rows` reads a JSON array from stdin - never pipe in a real client export; use
  synthetic or already-approved rows.

## Gotchas

- All mutating commands above are in clay-v2's `MUTATING` set: they exit code 2 with a
  safety notice unless you pass `--confirm` (or you're inside the scoped
  `--dev-mode`, see `/clay-onboarding`).
- `--auto-confirm` / `--confirm-all` / `--yes-to-all` are rejected outside dev-mode -
  don't try to script around the confirmation gate.
- Writes only land inside the scope(s) built from `CLAY_WORKSPACE_ID` /
  `CLAY_FOLDER_ID` (or `CLAY_WRITE_SCOPES` for multiple scopes) - see
  `/clay-onboarding` for setting those env vars; no source edit needed on a fresh
  clone.

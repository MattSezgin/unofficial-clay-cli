---
name: clay-export
description: Extract Clay table/workbook data to local files - use when you need a full-fidelity workbook export, a template-shaped snapshot of a table, or raw paginated row dumps for offline processing.
---

# clay-export

Every export in this skill writes real row data (contact info, enrichment results,
sometimes raw action-cell payloads) to your local disk. None of it belongs in a public
repo - see the redaction rule at the bottom before you share anything you exported.

## Full-fidelity workbook export (all rows, all tables)

```bash
python3 full_export.py wb_TEST_WORKBOOK ./exports/wb_TEST_WORKBOOK
```

- Exports **every row of every table** in the workbook, including action-cell
  `externalContent` (the full raw payload behind an enrichment result, not just its
  display value).
- Writes three files per table: `<table>__raw.json`, `<table>__flat.csv`,
  `<table>__schema.json`.
- Reads the session cookie from `../.clay-session` relative to the script - same
  parent-directory session as everything else (`/clay-onboarding`).
- Rate-limited to one request per ~0.4s, in batches of 50 rows - large workbooks take
  a while; let it run rather than parallelizing manually.

## Template-shaped snapshot (clay-v2.js)

```bash
node clay-v2.js workbook-export wb_TEST_WORKBOOK --include-rows 20 --out workbook.json --template-out table.yaml
```

- `--template-out file` additionally writes a spec-shaped YAML you can feed straight
  into `export-spec`/`apply-spec` (`/clay-build-table`) - useful when you want the
  *shape* of a workbook without a full data dump.
- Output through `clay-v2.js` is redacted by default; pass `--raw` only when you
  specifically need unredacted values and understand you now own keeping that file
  private.

## Raw paginated reads (clay-api.js)

```bash
node clay-api.js table-records t_TEST_TABLE gv_TEST_VIEW
node clay-api.js rows t_TEST_TABLE gv_TEST_VIEW 50 0
```

- `rows <tableId> <viewId> [limit] [offset]` - manual pagination, no redaction layer.
- `table-records` returns the view's records directly. Neither command redacts output
  - treat everything they print as sensitive by default.

## Before you share any export

- `.csv`, `.xlsx`, `.har`, screenshots, and similar file types are **structurally
  disallowed** anywhere in this repo - the CI safety scanner (`scripts/scan-repo.js`)
  blocks them outright, and for good reason: a table export is contact data.
- Keep exports in the repo's ignored `runs/`/`exports/` directories (or entirely
  outside the repo) - never `git add` an export.
- If you need to share what an export contains (in an issue, a PR description, a
  teammate chat), run it through `node clay-v2.js redact export.json --report
  redact-report.json` first (see `/clay-run-enrichment`), or hand-pick a couple of rows
  and manually replace names/emails/domains with placeholders like `{{email}}`.
- See `/clay-security-guide` for the full list of what actually leaks and how the
  scanner catches it.

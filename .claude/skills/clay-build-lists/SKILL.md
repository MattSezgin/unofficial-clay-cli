---
name: clay-build-lists
description: Build Clay list-building sources - company-to-people waterfalls, source preview/import, and webhook intake - use when adding a new list-building source to a table or converting a companies table into a people search.
---

# clay-build-lists

Sources are how Clay pulls new rows into a table (people/company search, webhooks).
Every command that touches Clay live is mutating and needs either `--confirm` (with
prior exact-command chat approval) or `--dev-mode` inside the scoped sandbox from
`/clay-onboarding`. None of `source-preview`, `source-import`, or
`create-webhook-source` has a `--dry-run` mode - write out the exact live command
(table/workspace IDs, spec file, flags) and get it approved in chat before adding
`--confirm`.

## Company -> people waterfall

```bash
node clay-v2.js build-people-source-from-companies t_TEST_COMPANY_TABLE \
  --view gv_TEST_VIEW \
  --domain-field "Resolved Domain" \
  --company-table-field f_TEST_SOURCE_FIELD \
  --limit 10 \
  --out people-source.yaml
```

This reads a companies table, extracts unique domains from `--domain-field`, and
writes a people-source spec YAML with those domains as the search filter. It only
writes a local file - no live call - but it is dev-mode-scope aware, and `--limit`
defaults to 10 (dev-mode caps it at 10 regardless).

**The `company_identifier` gotcha:** the generated spec's `source.filters` includes
`company_identifier` (the domain list) and `company_record_id` (the matching company
record IDs), and the code hard-fails if those two lists end up different lengths - a
record/domain count mismatch means something in your companies table is inconsistent
(duplicate or missing domains). Domains must also be **bare** - the extractor only
keeps values containing a `.` and rejects anything containing `://`; strip
`https://` and any path before it reaches this field.

## Preview and import a source spec

```bash
node clay-v2.js source-preview people-source.yaml --workspace {{workspace_id}} --dev-mode
# or, outside dev-mode, after exact-command chat confirmation:
node clay-v2.js source-preview people-source.yaml --workspace {{workspace_id}} --confirm

node clay-v2.js source-import people-source.yaml --destination-table t_TEST_TABLE --confirm
```

- `source-preview` clamps its result limit to 1-50 and always sets `result_count:true`
  - always look at the preview before importing.
  - For a `people-from-companies`-style flow: the first live step is only the
    **company-source preview**. Never chain it straight into company-source import,
    table creation, or a dependent people-source preview/import in the same
    confirmation - review the redacted preview evidence, then ask for the next exact
    command separately.
- `source-import` creates the CPJ (Company/Person/Job) source plus basic fields, and
  optional `extract` output fields, on the destination table.

## Webhook sources

```bash
node clay-v2.js create-webhook-source t_TEST_TABLE --name "My Webhook" --confirm
```

- Refuses to create a duplicate webhook on the same table unless you pass
  `--allow-duplicate-webhook`.
- A Clay webhook source URL accepts data from **anyone who has it** - treat the
  resulting URL like a password (see `/clay-security-guide`); never paste it
  anywhere public.

## Gotchas

- `--dev-mode` on these commands is hard-scoped to a specific sandbox
  workspace/folder configured in source - see `/clay-onboarding` for what that means
  for your own workspace.
- None of these commands accept `--auto-confirm`/`--confirm-all`/`--yes-to-all` outside
  dev-mode; the CLI rejects them outright.
- `source-preview`/`source-import` both accept `--out file` to save the JSON result for
  later readback with `/clay-run-enrichment` commands.

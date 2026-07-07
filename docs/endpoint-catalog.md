# Clay Endpoint Catalog — Discovery Draft

*Created: 2026-06-05 during Clay CLI v2 discovery.*

Status labels:

- `live-read`: verified against the operator's Clay session with a read-only call.
- `existing-cli`: implemented in current `clay-api.js`.
- `autoclay-note`: copied from an internal endpoint-capture corpus used during development; not yet verified in our session.
- `write-existing-cli`: implemented but mutating / credit-consuming; not run during discovery.
- `needs-browser`: likely requires UI/network capture.
- `unknown`: not discovered yet.

## Safety Boundary

- Testing workspace: `TEST_WS`.
- Only allowed Clay-side write target: folder `your sandbox folder` (`f_TEST_FOLDER`).
- No writes have been run in discovery so far.

## Current CLI Endpoint Surface

These are the endpoints currently called by `clay-api.js`.

| Method | Path Template | Current Command(s) | Status | Notes |
|---|---|---|---|---|
| POST | `/v3/auth/login` | `login` | existing-cli | Uses email/password; the operator's current session is cookie-based. |
| GET | `/v3/me` | `me` | live-read | **Leaks `apiToken` in raw output. Must redact by default in v2.** |
| GET | `/v3/my-workspaces` | `workspaces` | live-read | Returns workspace settings, app-account maps, feature flags, credits. Needs redaction. |
| GET | `/v3/workspaces/:wsId` | `workspace` | existing-cli | Summary output already trims some fields. |
| POST | `/v3/workspaces/:wsId/resources_v2/` | `tables` | live-read | Lists folders/workbooks/tables. Parent folder query found `your sandbox folder`, with 0 children. |
| GET | `/v3/workspaces/:wsId/permissions` | `permissions` | existing-cli | Read-only but may contain users/PII. |
| GET | `/v3/workspaces/:wsId/users` | none direct | existing-cli method only | Not exposed in CLI command. |
| GET | `/v3/workspaces/:wsId/signals` | `signals` | existing-cli | Read-only. |
| GET | `/v3/workspaces/:wsId/workbooks` | `workbooks` | existing-cli | Read-only. |
| GET | `/v3/workspaces/:wsId/app-accounts` | `integrations` | existing-cli | Sensitive: account IDs/labels. Redact by default. |
| POST | `/v3/workspaces/:wsId/folders` | `create-folder` | write-existing-cli | Mutating. Only your sandbox folder if needed; likely not needed. |
| POST | `/v3/workbooks` | `create-workbook` | write-existing-cli | Mutating. Must support parent folder and scratch naming. |
| DELETE | `/v3/workbooks/:workbookId` | `delete-workbook` | write-existing-cli | Destructive/soft-delete. Needs chat confirm. |
| DELETE | `/v3/workspaces/:wsId/resources/` | `delete-resources` | write-existing-cli | Destructive; can permanently delete. Needs strongest gate. |
| POST | `/v3/tables` | `create-table` | write-existing-cli | Mutating. The internal endpoint-capture corpus notes `template: "no_views"` for exact view parity. Current CLI does not. |
| GET | `/v3/tables/:tableId` | `table-info` | existing-cli | Current command summarizes and loses config. v2 needs raw/manifest mode. |
| GET | `/v3/tables/:tableId/count` | `table-count` | existing-cli | Read-only. |
| GET | `/v3/tables/:tableId/views/:viewId/records/ids` | `table-records` | existing-cli | Workaround for broken row pagination. |
| GET | `/v3/tables/:tableId/views/:viewId/records` | `rows` | existing-cli | Pagination known broken after ~500 rows. Use IDs + bulk/single fetch. |
| GET | `/v3/tables/:tableId/records/:recordId` | `record` | existing-cli | Single record. Current command resolves names but loses raw cell metadata. |
| POST | `/v3/tables/:tableId/records` | `add-rows` | write-existing-cli | Current code wraps row values as generated records. The internal endpoint-capture corpus notes direct scalar values are expected. Need readback tests. |
| PATCH | `/v3/tables/:tableId/records/:recordId` | `update-record` | write-existing-cli | Current code writes `{ fieldId: { value } }`; may differ from scalar expectation by endpoint. Needs test. |
| PATCH | `/v3/tables/:tableId/records` | `update-records` | write-existing-cli | Bulk cell mutation. Needs schema tests. |
| DELETE | `/v3/tables/:tableId/records` | `delete-rows` | write-existing-cli | Uses unusual form-encoded JSON-as-key body. Destructive. |
| PATCH | `/v3/tables/:tableId/run` | `run-enrichment` | write-existing-cli | Credit-consuming. Uses unusual form encoding. Must default to top-N only. |
| POST | `/v3/tables/:tableId/fields` | `create-field` | live-verified-write-in-testing-folder | Verified basic text/url/number, formula, and HTTP API action creation in your sandbox folder. Formula requires `formulaType` + `formulaText`. HTTP action needs `dataTypeSettings.type=json` and exact action input names (`url`, not UI label `Endpoint`). |
| PATCH | `/v3/tables/:tableId/fields/:fieldId` | `rename-field`, method | write-existing-cli | Same-action updates likely possible. Clay rejects actionKey switching. |
| DELETE | `/v3/tables/:tableId/fields/:fieldId` | `delete-field` | write-existing-cli | Destructive. |
| POST | `/v3/tables/:tableId/views` | `create-view` | write-existing-cli | Basic only. Need filters/sorts/order support discovery. |
| GET | `/v3/tables/:tableId/views/:viewId` | `view-details` | existing-cli | Read-only. |
| DELETE | `/v3/tables/:tableId/views/:viewId` | `delete-view` | write-existing-cli | Destructive. |
| GET | `/v3/sources?tableId=:tableId` | `sources` | existing-cli | Read-only source metadata. |
| PATCH | `/v3/tables/:tableId` | `add-webhook` | write-existing-cli | Current sourceSettings payload creates webhook source. Needs readback validation. |
| DELETE | `/v3/sources/:sourceId` | `delete-source` | write-existing-cli | Destructive. |
| GET | `/v3/credit-reporting/:wsId/creditReportType/workspace` | `credits` | existing-cli | Read-only cost report. |
| GET | `/v3/credit-reporting/:wsId/creditReportType/integration` | `credits-by-integration` | existing-cli | Read-only cost report. |

## Internal Endpoint-Capture Corpus Notes To Verify

These notes were copied from an internal endpoint-capture corpus assembled during development (network captures of the Clay UI) and are not yet independently verified in a live session.

| Method | Path Template | Purpose | Status | Notes |
|---|---|---|---|---|
| GET | `/v3/tables/:tableId?extraDataViewId=:viewId&includeExtraData=true` | Full table manifest/readback | live-read | Verified in your sandbox folder. Response shape: `{ table, extraData }`. Higher-fidelity than current summary. |
| GET | `/v3/workspaces/:workspaceId/tables/:tableId/fields/runstatus` | Field run status | live-read | Verified in your sandbox folder. Response shape: `{ statusCountsByField: { [fieldId]: [] } }` for non-run fields. |
| POST | `/v3/tables/:sourceTableId/duplicate/` | Duplicate table | autoclay-note | May preserve more config than from-scratch; mutation only in your sandbox folder. |
| PATCH | `/v3/tables/:tableId/views/:viewId/fields/:fieldId` | View field order/hidden state | autoclay-note | Sequential reorder fallback. |
| POST | `/v3/tables/:tableId/fields/group` | Create field group | autoclay-note | Needed for parity. |
| POST | `/v3/tables/:tableId/fields/group/:groupId` | Update field group | autoclay-note | Needed for parity. |
| POST | `/v3/tables/:tableId/bulk-fetch-records` | Fetch records + action external content | existing in `full_export.py` | Current Python uses this successfully. Should port/wrap. |

## Source / Search Builder Unknowns

These are the highest-value unknowns for the operator's "do anything the UI can do" goal.

| UI Operation | Public Docs Say | Current API Status | Discovery Path |
|---|---|---|---|
| Create Find Companies table | `+ Add` in workbook → Find Companies → configure filters → Preview → Import | unknown | Browser/network capture inside your sandbox folder. |
| Configure Find Companies filters | industry, size, revenue, funding, company type, keywords, semantic description, location, estimated employees, AI filters, technographics, domain filters, exclusions, limit | unknown | Capture generated source payload. |
| Create Find People table | `+ Add` → Find People → configure filters → Import | unknown | Browser/network capture. |
| Find People at These Companies as source | Creates separate people table + Company Table Data link; Update People Table column can rerun full search | unknown | Capture from company table in your sandbox folder. |
| Find People as in-table action | Returns people in a cell; can dynamically filter by row location; no separate rows | unknown action payload | Capture action drawer + readback. |
| Source rerun / edit | Sources are additive; source histories can block reimports | unknown | Browser/network capture + source readback. |

## Action Payload Priorities

From our needs + the internal endpoint-capture corpus:

1. `use-ai` / Claygent variants — hardest, highest value.
2. `http-api-v2` — known action key/package from the internal endpoint-capture corpus.
3. Formula fields — must support correct formula type/input mode.
4. Extracted child fields — output mapping from parent action cell.
5. Lookup single/multiple rows — free, useful for suppression/gating.
6. Send Table Data — multi-table routing / flatten list; 20 item per row limit.
7. Smartlead action family — campaign upload/routing.
8. Slack/Sheets/HubSpot native actions.
9. Source builders — Find Companies / Find People.

## Critical Behavioral Notes From Public Docs

- Clay tables have 50k row limits; source record counts do not decrease on row deletion for most source types.
- Find Companies import is free except technographics filters at 3 credits per matching row.
- Find Companies preview counts are approximate and imports are async.
- Find People preview shows up to 50; actual import respects `Limit results` and `Limit per company`.
- Find People with `Limit per company` may initially import only ~48-50 rows; workaround is edit/re-run or create a new table.
- Sources generally do not support run conditions; use filtered views to scope Find People at companies.
- Webhook source accepts exactly one row per POST; arrays become one row, not many.
- Webhook throughput: 10 req/s sustained, burst 20; 100KB payload; 50k submissions/source.
- Use AI has Generate and Configure modes; API automation must represent Configure settings, not just natural-language generation.
- Use AI JSON Schema forbids unsupported keywords like `minimum`, `maximum`, `pattern`, `minItems`, etc.; arrays require `items`; no trailing commas.
- Use AI web research / Claygent output includes `response`, `reasoning`, `confidence`, `stepsTaken` unless named outputs are configured.
- Run progress counts `Successful`, `Running`, `Failed`; run condition not met counts as successful but empty downstream.
- Stop cancels queued cells, not in-flight provider calls; in-flight calls may still consume credits.
- Row limit / starting row controls visible/eligible rows but progress bars count all rows.
- Sandbox mode duplicates top 10 rows, max 50; cannot add/edit sources in sandbox; outbound actions disabled.

## v2 Redaction Requirements

Redact by default in any command output/artifact:

- session cookies, auth headers, bearer tokens, API keys, passwords
- `/v3/me.apiToken`
- workspace `PROVIDER_TO_APP_ACCOUNT_ID_MAP` unless explicitly requested
- webhook URLs and auth tokens
- Slack webhook URLs / channel IDs if client-specific
- Google Sheet IDs, Smartlead campaign/client IDs in public artifacts
- formulas and `inputsBinding` values containing secret-looking strings
- row PII in screenshots/HARs/manifests unless local-only and gitignored

## Immediate Next Tests (Read-Only)

1. Live-verify `GET /v3/tables/:id?extraDataViewId=:viewId&includeExtraData=true` against a non-sensitive table in your sandbox folder if one exists; currently folder has no child resources.
2. If no sandbox table exists, ask the operator before creating a scratch workbook/table there.
3. Mine existing public docs/action terms into an action catalog without using live Clay writes.

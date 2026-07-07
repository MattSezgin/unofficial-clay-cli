# smartlead-lookup-lead-status

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_missing_safe_test_data`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `smartlead-lookup-lead-status`
- `actionPackageId`: `6e7ab2da-0d97-49ab-ba78-a6b2f3bf2029`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `campaign_id`
- `email`

### Optional observed
- None observed/curated.

### Candidate-required observed
- `campaign_id`
- `email`

## Extracted output paths observed/proven

- None observed/curated.

## Proof / block summary

Blocked: `blocked_missing_safe_test_data`. Strict proof requires an approved sandbox Smartlead campaign_id plus known test email/lead state. Shared workbook exports expose production campaign IDs only; no sandbox campaign/lead identifiers were approved for proof, so the action is blocked rather than run against production campaign data.

## Status semantics

- `not_run/blocked_missing_safe_test_data` — Read-only Smartlead lookup was not executed because strict proof needs approved sandbox campaign/lead data that can produce auditable parent fullValue; production campaign contexts from exports were not used as proof.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/smartlead-lookup-lead-status.yaml`

# trigger-find-people-source

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_missing_safe_test_data`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `trigger-find-people-source`
- `actionPackageId`: `4299091f-3cd3-4d68-b198-0143575f471d`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `sourceId`
- `companyIdentifier`

### Optional observed
- `enableAutoUpdate`

### Candidate-required observed
- `companyIdentifier`
- `enableAutoUpdate`
- `sourceId`

## Extracted output paths observed/proven

- None observed/curated.

## Proof / block summary

Blocked: `blocked_missing_safe_test_data`. Approved one-row sandbox proof ran against existing safe people source s_TEST_SOURCE and returned SUCCESS with value "People Search Skipped", but produced no parent fullValue and no extracted/materialized action output to verify. Strict proof requires materialized source outputs, not just a skipped/no-op trigger, so this remains blocked until a fresh safe source/company-trigger proof can materialize new rows.

## Status semantics

- `SUCCESS/People Search Skipped` — Trigger accepted the request but skipped updating the people source; no parent fullValue is produced and no materialized output is available for strict proof.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/trigger-find-people-source.yaml`

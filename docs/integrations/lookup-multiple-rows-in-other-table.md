# lookup-multiple-rows-in-other-table

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `lookup-multiple-rows-in-other-table`
- `actionPackageId`: `4299091f-3cd3-4d68-b198-0143575f471d`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `tableId`

### Optional observed
- `fields|filterOperator`
- `fields|limit`
- `fields|rowValue`
- `fields|targetColumn`

### Candidate-required observed
- `fields|filterOperator`
- `fields|rowValue`
- `fields|targetColumn`
- `tableId`

## Extracted output paths observed/proven

- `Number Of Results-team-mate`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Matched lookup returns records[] plus numberOfResults; extracted numberOfResults and first record full name are non-empty.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/lookup-multiple-rows-in-other-table.yaml`

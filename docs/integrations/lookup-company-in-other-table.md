# lookup-company-in-other-table

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `lookup-company-in-other-table`
- `actionPackageId`: `4299091f-3cd3-4d68-b198-0143575f471d`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `companyTableId`
- `companyRecordId`

### Optional observed
- None observed/curated.

### Candidate-required observed
- `companyRecordId`
- `companyTableId`

## Extracted output paths observed/proven

- `Example Reference Field`
- `Example Output Field`
- `Example Snippet Field`
- `Comparison Target Name`
- `Csv Platform Rank`
- `Flagship Product Name`
- `Phone Number`
- `Question_1`
- `Question_2`
- `Question_3`
- `Account Name`
- `Contact Window`
- `Contact Window (2)`
- `csv-Domain`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Valid companyTableId/companyRecordId returns company record object with resolved domain/name/LinkedIn URL.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/lookup-company-in-other-table.yaml`

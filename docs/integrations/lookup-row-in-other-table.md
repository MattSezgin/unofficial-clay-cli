# lookup-row-in-other-table

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `lookup-row-in-other-table`
- `actionPackageId`: `4299091f-3cd3-4d68-b198-0143575f471d`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `tableId`

### Optional observed
- `fields|filterOperator`
- `fields|rowValue`
- `fields|targetColumn`

### Candidate-required observed
- `fields|filterOperator`
- `fields|rowValue`
- `fields|targetColumn`
- `tableId`

## Extracted output paths observed/proven

- `# Employees`
- `Example Output Field`
- `Company Country`
- `Company Name`
- `Company Size`
- `Company Type`
- `Email Status`
- `Email-3`
- `Job Description`
- `Linkedin-url`
- `Phone Number`
- `Preferred Linkedin Company URL`
- `Primary Email Catch All Status`
- `Question_1`
- `Question_2`
- `Question_3`
- `Contact Window`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Matched lookup returns parent fullValue with record object; extracted record fields are non-empty.
- `SUCCESS_NO_DATA` — No matching row returns visible ❌ No Record Found and no parent fullValue; this is expected no-data behavior, not a settings error.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/lookup-row-in-other-table.yaml`

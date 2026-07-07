# enrich-company-with-mixrank-v2

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `enrich-company-with-mixrank-v2`
- `actionPackageId`: `e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `company_identifier`

### Optional observed
- None observed/curated.

### Candidate-required observed
- `company_identifier`

## Extracted output paths observed/proven

- `Country`
- `Description`
- `Employee Count`
- `Industry`
- `Size`
- `Url`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- Status semantics not fully proven; see proof/block summary.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/enrich-company-with-mixrank-v2.yaml`

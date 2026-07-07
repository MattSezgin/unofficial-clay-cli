# normalize-company-name

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `normalize-company-name`
- `actionPackageId`: `6c973999-fb78-4a5a-8d99-d2fee5b73878`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `companyName`

### Optional observed
- `titleCase`

### Candidate-required observed
- `companyName`
- `titleCase`

## Extracted output paths observed/proven

- `Normalized Company Name`
- `Normalized Name`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Returns parent fullValue with original_name and normalized_name. In proof, all 10 real company-name rows returned fullValue and both extracted outputs were non-empty.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/normalize-company-name.yaml`

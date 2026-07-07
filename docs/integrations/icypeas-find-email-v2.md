# icypeas-find-email-v2

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `icypeas-find-email-v2`
- `actionPackageId`: `303cd8bc-26dc-4c8c-bd5a-e94528d6c77d`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `first_name`
- `last_name`
- `domain`

### Optional observed
- `fullname`

### Candidate-required observed
- `domain`
- `fullname`

## Extracted output paths observed/proven

- `icy email`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Found emails return parent fullValue with email, emails[], status=FOUND, success=true, certainty, searchId.
- `SUCCESS_NO_DATA` — No email found returns visible no-email value and null parent fullValue; extracted field may show Clay metadata for no-data rows, so parent fullValue is truth.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/icypeas-find-email-v2.yaml`

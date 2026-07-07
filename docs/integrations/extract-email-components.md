# extract-email-components

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `extract-email-components`
- `actionPackageId`: `4299091f-3cd3-4d68-b198-0143575f471d`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `email`

### Optional observed
- (none observed)

### Candidate-required observed
- `email`

## Extracted output paths observed/proven

- `address`
- `domain`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Parsed email/domain successfully; parent fullValue contains address/domain/emailProvider and boolean classification keys.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/extract-email-components.yaml`

# generate-email-permutations

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `generate-email-permutations`
- `actionPackageId`: `4299091f-3cd3-4d68-b198-0143575f471d`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `full_name`
- `company_domain`

### Optional observed
- (none observed)

### Candidate-required observed
- `full_name`
- `company_domain`

## Extracted output paths observed/proven

- `first_name`
- `last_name`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Generated email permutations successfully; parent fullValue contains permutations, comma_separated_list, first_name, and last_name.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/generate-email-permutations.yaml`

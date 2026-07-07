# enrich-person-with-mixrank-v2

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `enrich-person-with-mixrank-v2`
- `actionPackageId`: `e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `person_identifier`

### Optional observed
- `email`

### Candidate-required observed
- `email`
- `person_identifier`

## Extracted output paths observed/proven

- `Name`
- `Url`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Mixrank returned a hydrated person profile object for the supplied LinkedIn/person identifier. Invalid/malformed identifiers can produce ERROR_INVALID_INPUT; proof used a clean bounded identifier formula after documenting that case.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/enrich-person-with-mixrank-v2.yaml`

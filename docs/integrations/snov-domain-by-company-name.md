# snov-domain-by-company-name

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `snov-domain-by-company-name`
- `actionPackageId`: `d8c220e0-401e-49ca-8c6b-37c7577baffd`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `companyName`

### Optional observed
- None observed/curated.

### Candidate-required observed
- `companyName`

## Extracted output paths observed/proven

- None observed/curated.

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Returns parent fullValue with domain. Proof had 9/10 successful domain matches.
- `SUCCESS_NO_DATA` — No domain found returns visible ❌ No domain found and parent fullValue null. This is expected no-data behavior; extracted output readback may surface Clay metadata for the no-data row, so parent fullValue is the truth source.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/snov-domain-by-company-name.yaml`

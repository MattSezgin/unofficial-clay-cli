# datagma-find-work-email-v3

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `datagma-find-work-email-v3`
- `actionPackageId`: `f240a97e-3d3e-4ffa-a85e-8d70afe348a5`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `full_name`
- `company_domain`

### Optional observed
- None observed/curated.

### Candidate-required observed
- `company_domain`
- `full_name`

## Extracted output paths observed/proven

- None observed/curated.

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Found rows have parent externalContent.fullValue containing email data; extracted email/status fields must be non-empty before treating as usable.
- `SUCCESS_NO_DATA` — No-data rows are expected provider misses. Parent fullValue may be null or may contain provider payload with null email/unfound status depending on provider; parent fullValue + extracted email is truth.
- `ERROR` — Runtime errors block promotion unless isolated to a separate non-proof path.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/datagma-find-work-email-v3.yaml`

# findymail-find-work-email

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `findymail-find-work-email`
- `actionPackageId`: `9515bb04-4267-4074-94eb-653545c3c38f`
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

- `SUCCESS` — Found emails return parent fullValue with email and status, with observed status=valid for found rows.
- `SUCCESS_NO_DATA` — No email found rows display no-email behavior; parent fullValue may contain null email/status, so non-empty email extraction is required before treating as found.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/findymail-find-work-email.yaml`

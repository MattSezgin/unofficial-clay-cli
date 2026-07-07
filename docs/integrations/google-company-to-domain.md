# google-company-to-domain

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `google-company-to-domain`
- `actionPackageId`: `3282a1c7-6bb0-497e-a34b-32268e104e55`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `query`

### Optional observed
- `country`
- `exclude`
- `language`

### Candidate-required observed
- `query`

## Extracted output paths observed/proven

- `Domain`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Returns parent fullValue with domain, originalURL, and title. Proof returned 10/10 domains. Ambiguity is possible: one row resolved one ambiguous small-business name to a third-party Prospeo profile URL/domain, so downstream workflows should verify domain fit when company names are ambiguous.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/google-company-to-domain.yaml`

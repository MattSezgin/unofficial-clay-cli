# hg-insights-find-domain-from-company-name

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `hg-insights-find-domain-from-company-name`
- `actionPackageId`: `b7f3454a-5095-4cb2-b91b-79cdb54e0dd2`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `company_name`

### Optional observed
- None observed/curated.

### Candidate-required observed
- `company_name`

## Extracted output paths observed/proven

- None observed/curated.

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Returns parent fullValue with possible_matches array. The first match can be extracted via possible_matches.0.company_domain and possible_matches.0.company_name, but multiple matches may be returned and first-match is not always authoritative.
- `SUCCESS_NO_DATA` — No company found returns visible ❌ No company found and parent fullValue null. This is expected no-data behavior; extracted output readback may surface Clay metadata for no-data rows, so parent fullValue is the truth source.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/hg-insights-find-domain-from-company-name.yaml`

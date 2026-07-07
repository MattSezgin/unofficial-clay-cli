# prospeo-find-work-email-v2

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_missing_safe_test_data`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `prospeo-find-work-email-v2`
- `actionPackageId`: `48a31bbb-63e6-4461-8a62-d88bb2cd6b0f`
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
- `include_catch_all`

### Candidate-required observed
- `company_domain`
- `full_name`

## Extracted output paths observed/proven

- `Email (2)`
- `Prospeo Email`

## Proof / block summary

Blocked: `blocked_missing_safe_test_data`. Both bounded sandbox Prospeo probes (include_catch_all false and true) returned SUCCESS_NO_DATA:10 with null parent fullValue and no extracted email/status values. No runtime error, but no strict found-output proof exists for promotion.

## Status semantics

- `SUCCESS_NO_DATA` — Provider returned no email found; parent fullValue null. Safe probe establishes no-data behavior only, not found-output mapping.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/prospeo-find-work-email-v2.yaml`

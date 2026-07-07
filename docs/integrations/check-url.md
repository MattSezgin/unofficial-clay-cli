# check-url

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_missing_safe_test_data`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `check-url`
- `actionPackageId`: `4299091f-3cd3-4d68-b198-0143575f471d`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `url`

### Optional observed
- `tryVariants`
- `enableProxyFallback`
- `treatTimeoutsAsInvalid`

### Candidate-required observed
- `url`
- `tryVariants`
- `enableProxyFallback`
- `treatTimeoutsAsInvalid`

## Extracted output paths observed/proven

- None observed/curated.

## Proof / block summary

Blocked: `blocked_missing_safe_test_data`. Gap audit found real sandbox workbook fixture action `Generic Check URL Valid`, but no strict proof packet with parent fullValue/extracted output/value QA was recorded. Needs bounded safe URL rerun/readback before promotion.

## Status semantics

- Status semantics not fully proven; see proof/block summary.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/check-url.yaml`

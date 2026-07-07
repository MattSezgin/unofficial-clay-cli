# lookup-lead-in-campaign

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_missing_safe_test_data`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `lookup-lead-in-campaign`
- `actionPackageId`: `6e7ab2da-0d97-49ab-ba78-a6b2f3bf2029`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `email`

### Optional observed
- None observed/curated.

### Candidate-required observed
- `email`

## Extracted output paths observed/proven

- `Is Unsubscribed`
- `Lead Category Id`

## Proof / block summary

Blocked: `blocked_missing_safe_test_data`. Strict proof requires an approved sandbox Smartlead lead/campaign state where the lookup can return parent fullValue and extracted lead-category/unsubscribe outputs. Shared exports only expose production campaign/lead contexts, and using those for proof would not satisfy the sandbox requirement. No production campaign read path was promoted.

## Status semantics

- `not_run/blocked_missing_safe_test_data` — Read-only Smartlead lookup was not executed because strict proof needs approved sandbox campaign/lead data that can produce auditable parent fullValue; production campaign contexts from exports were not used as proof.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/lookup-lead-in-campaign.yaml`

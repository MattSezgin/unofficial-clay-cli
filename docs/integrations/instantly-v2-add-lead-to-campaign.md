# instantly-v2-add-lead-to-campaign

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_destructive_external_mutation`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `instantly-v2-add-lead-to-campaign`
- `actionPackageId`: `70cda03a-a576-4a6c-b3b3-55e241f828b5`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `email`
- `campaign_id`

### Optional observed
- `campaign`
- `company_name`
- `custom_variables`
- `first_name`
- `last_name`
- `personalization`
- `phone`
- `skip_if_in_workspace`
- `website`

### Candidate-required observed
- `campaign`
- `company_name`
- `custom_variables`
- `email`
- `first_name`
- `last_name`
- `personalization`
- `phone`
- `skip_if_in_workspace`
- `website`

## Extracted output paths observed/proven

- None observed/curated.

## Proof / block summary

Blocked: `blocked_destructive_external_mutation`. This action mutates Instantly campaign/workspace state by adding a lead to a campaign. No approved sandbox Instantly campaign and lead-add mutation scope exists, and production campaign mutation is explicitly out of scope. Requires explicit per-command HITL approval with sandbox campaign identifiers before any live proof run.

## Status semantics

- `not_run/blocked_destructive_external_mutation` — Campaign add action was not executed because it mutates an external sequencer campaign and requires explicit sandbox HITL approval.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/instantly-v2-add-lead-to-campaign.yaml`

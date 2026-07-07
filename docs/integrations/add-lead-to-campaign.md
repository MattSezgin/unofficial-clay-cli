# add-lead-to-campaign

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_destructive_external_mutation`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `add-lead-to-campaign`
- `actionPackageId`: `6e7ab2da-0d97-49ab-ba78-a6b2f3bf2029`
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
- `allow_duplicate_leads_in_another_campaign`
- `allow_leads_from_community_bounce_list`
- `company_name`
- `company_url`
- `custom_fields`
- `first_name`
- `last_name`
- `linkedin_profile`
- `location`
- `phone_number`
- `website`

### Candidate-required observed
- `allow_duplicate_leads_in_another_campaign`
- `allow_leads_from_community_bounce_list`
- `campaign_id`
- `company_name`
- `company_url`
- `custom_fields`
- `email`
- `first_name`
- `last_name`
- `linkedin_profile`
- `location`
- `phone_number`
- `website`

## Extracted output paths observed/proven

- None observed/curated.

## Proof / block summary

Blocked: `blocked_destructive_external_mutation`. This action mutates Smartlead/sequencer state by adding a lead to a campaign. No approved sandbox campaign and lead-add mutation scope exists, and production campaign mutation is explicitly out of scope. Requires explicit per-command HITL approval with sandbox campaign identifiers before any live proof run.

## Status semantics

- `not_run/blocked_destructive_external_mutation` — Campaign add action was not executed because it mutates an external sequencer campaign and requires explicit sandbox HITL approval.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/add-lead-to-campaign.yaml`

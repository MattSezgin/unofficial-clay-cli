# apollo-oauth-enrich-person

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_external_dependency`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `apollo-oauth-enrich-person`
- `actionPackageId`: `778df10d-f68b-461a-8eb7-56047737f5eb`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `first_name`
- `last_name`
- `domain`

### Optional observed
- `email`
- `id`
- `name`
- `organization_name`

### Candidate-required observed
- `domain`
- `email`
- `first_name`
- `id`
- `last_name`
- `name`
- `organization_name`

## Extracted output paths observed/proven

- `Linkedin Url - Person`

## Proof / block summary

Blocked: `blocked_external_dependency`. Bounded sandbox proof with the only discovered safe same-workspace Apollo OAuth account returned ERROR_INVALID_CREDENTIALS:10 (Invalid account response), with no parent fullValue. No alternate safe Apollo auth account was available, so strict proof is blocked rather than guessed.

## Status semantics

- `ERROR_INVALID_CREDENTIALS` — Configured Apollo OAuth account was rejected by the provider/Clay action; no parent fullValue is produced.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/apollo-oauth-enrich-person.yaml`

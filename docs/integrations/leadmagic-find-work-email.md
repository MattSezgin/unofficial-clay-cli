# leadmagic-find-work-email

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_external_dependency`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `leadmagic-find-work-email`
- `actionPackageId`: `edb58209-a62d-42be-992a-e41b87eeacc2`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `name`
- `domain`

### Optional observed
- `includeCatchAll`

### Candidate-required observed
- `domain`
- `name`

## Extracted output paths observed/proven

- `Email`
- `Email-2`
- `Employment Verified`
- `Status (2)`
- `leadmagic-email`

## Proof / block summary

Blocked: `blocked_external_dependency`. Clean sandbox proof paths did not produce a strict found-output proof: shared Clay-managed LeadMagic key returned SUCCESS_NO_DATA:9 + ERROR:1 Bad Request with no parent fullValue; the operator's LeadMagic key returned ERROR:10 Forbidden; existing historical field had one found row but unresolved ERROR:1 Bad Request, so strict proof path remains blocked.

## Status semantics

- `SUCCESS_NO_DATA` — Provider miss/no email found; parent fullValue null in clean proof.
- `ERROR` — Bad Request/Forbidden errors are unresolved on clean proof paths and block strict promotion.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/leadmagic-find-work-email.yaml`

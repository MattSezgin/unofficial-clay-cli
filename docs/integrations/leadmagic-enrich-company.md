# leadmagic-enrich-company

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_external_dependency`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `leadmagic-enrich-company`
- `actionPackageId`: `edb58209-a62d-42be-992a-e41b87eeacc2`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `domain`

### Optional observed
- `company_name`
- `company_linkedin_url`

### Candidate-required observed
- `domain`
- `company_name`
- `company_linkedin_url`

## Extracted output paths observed/proven

- None observed/curated.

## Proof / block summary

Blocked: `blocked_external_dependency`. Gap audit found export evidence for LeadMagic company enrichment, but current LeadMagic auth paths already showed Forbidden/Bad Request failures in related LeadMagic proofs. Needs safe working auth before promotion.

## Status semantics

- Status semantics not fully proven; see proof/block summary.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/leadmagic-enrich-company.yaml`

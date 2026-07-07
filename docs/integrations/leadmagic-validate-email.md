# leadmagic-validate-email

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `leadmagic-validate-email`
- `actionPackageId`: `edb58209-a62d-42be-992a-e41b87eeacc2`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `email`

### Optional observed
- `onlySafe`

### Candidate-required observed
- `email`
- `onlySafe`

## Extracted output paths observed/proven

- `Status`
- `Sub Status`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `invalid` — Known invalid test@example.com returns visible ❌ Invalid email and parent status=invalid.
- `noInput` — Blank upstream email inputs with run conditions show ERROR_RUN_CONDITION_NOT_MET and null parent fullValue; this is expected gating/no-input behavior, not provider validation output.
- `valid` — No valid LeadMagic validation row was observed in this proof batch; use parent status field for future valid vocabulary rather than guessing.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/leadmagic-validate-email.yaml`

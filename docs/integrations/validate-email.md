# validate-email

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `validate-email`
- `actionPackageId`: `8f0d2dc0-a6b4-4b84-9aad-a330b4a4586a`
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

- None observed/curated.

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `valid` — Real verified-send-email inputs return visible ✅ Valid email and parent status=valid.
- `invalid` — Known fallback test@example.com returns visible ❌ Invalid email, parent status=invalid, sub_status=does_not_accept_mail.
- `noData` — Not separately produced in this mixed proof because fallback forces blank/no-email rows into a known invalid input for status QA.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/validate-email.yaml`

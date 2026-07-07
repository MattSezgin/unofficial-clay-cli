# get-domain-from-company-name

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_requires_auth`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `get-domain-from-company-name`
- `actionPackageId`: `e5f3b09f-1b8f-4806-a960-27abf163940f`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `companyName`

### Optional observed
- None observed/curated.

### Candidate-required observed
- `companyName`

## Extracted output paths observed/proven

- None observed/curated.

## Proof / block summary

Blocked: `blocked_requires_auth`. Live sandbox create-action readback showed settingsError MISSING_AUTH (Required auth account is missing). Available workspace app-account inventory did not identify a safe matching account for package e5f3b09f-1b8f-4806-a960-27abf163940f, so this action is blocked rather than guessed.

## Status semantics

- `MISSING_AUTH` — Action field can be created with companyName binding, but Clay reports settingsError MISSING_AUTH before a valid run. Do not run or promote until a safe same-workspace auth account is identified.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/get-domain-from-company-name.yaml`

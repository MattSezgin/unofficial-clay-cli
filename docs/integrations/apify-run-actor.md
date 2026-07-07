# apify-run-actor

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_paid_or_unbounded_cost`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `apify-run-actor`
- `actionPackageId`: `ea91b0b8-6c78-4d32-a978-345e923bdc93`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `actorId`
- `data`

### Optional observed
- None observed/curated.

### Candidate-required observed
- `actorId`
- `data`

## Extracted output paths observed/proven

- None observed/curated.

## Proof / block summary

Blocked: `blocked_paid_or_unbounded_cost`. Approved one-row sandbox proof used an observed workbook actor ID and safe Apify account, but runtime returned actor-is-not-rented: the paid actor free trial expired and must be rented before it can run. Strict proof is blocked on paid external actor dependency.

## Status semantics

- `ERROR/actor-is-not-rented` — Apify rejected the actor run because the actor must be rented after trial expiration; no result payload/fullValue is produced.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/apify-run-actor.yaml`

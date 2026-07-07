# enrich-job

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_missing_safe_test_data`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `enrich-job`
- `actionPackageId`: `e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `job_id`

### Optional observed
- None observed/curated.

### Candidate-required observed
- `job_id`

## Extracted output paths observed/proven

- `Job Description`

## Proof / block summary

Blocked: `blocked_missing_safe_test_data`. Strict proof requires a real Clay job_id from a Find Jobs source. Shared workbook exports/onboarding only exposed the binding {{f_jobs_search}}?.job_id and no materialized job_id values. Guessing job IDs would not be a valid proof, so this action is blocked until a safe job source run/materialized job_id is approved or provided.

## Status semantics

- `blocked_missing_safe_test_data` — No safe materialized job_id was available; action not run.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/enrich-job.yaml`

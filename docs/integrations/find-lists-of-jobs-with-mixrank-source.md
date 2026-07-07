# find-lists-of-jobs-with-mixrank-source

## Status

- Promotion status: `reviewed`
- Proof status: `blocked_missing_safe_test_data`
- Strict battle-tested: `false`

## Action identity

- `actionKey`: `find-lists-of-jobs-with-mixrank-source`
- `actionPackageId`: `e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `limit`

### Optional observed
- `locations`
- `seniority`
- `startFrom`
- `company_table_id`
- `company_record_id`
- `company_identifier`
- `job_title_keywords`
- `job_description_keywords`
- `max_num_days_since_posted`

### Candidate-required observed
- `limit`
- `locations`
- `seniority`
- `startFrom`
- `company_table_id`
- `company_record_id`
- `company_identifier`
- `job_title_keywords`
- `job_description_keywords`
- `max_num_days_since_posted`

## Extracted output paths observed/proven

- `job_id`
- `title`
- `company`

## Proof / block summary

Blocked: `blocked_missing_safe_test_data`. Gap audit found exported job-source configs, but no bounded sandbox job-source materialization/readback proof exists. Prior `enrich-job` proof was blocked because no safe materialized job_id values were available. Needs safe bounded job source run before promotion.

## Status semantics

- Status semantics not fully proven; see proof/block summary.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/find-lists-of-jobs-with-mixrank-source.yaml`

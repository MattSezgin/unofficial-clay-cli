# find-lists-of-people-with-mixrank-source

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `find-lists-of-people-with-mixrank-source`
- `actionPackageId`: `e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `limit`
- `company_table_id`
- `company_record_id`
- `company_identifier`
- `start_from_method`

### Optional observed
- `job_title_keywords`
- `job_title_seniority_levels`
- `locations`
- `locations_exclude`
- `include_company_filter_identifier_count`

### Candidate-required observed
- `limit`
- `company_table_id`
- `company_record_id`
- `company_identifier`
- `start_from_method`
- `job_title_keywords`
- `job_title_seniority_levels`
- `locations`
- `locations_exclude`
- `include_company_filter_identifier_count`

## Extracted output paths observed/proven

- `full_name`
- `linkedin_url`
- `title`
- `latest_experience_company`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- Status semantics not fully proven; see proof/block summary.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/find-lists-of-people-with-mixrank-source.yaml`

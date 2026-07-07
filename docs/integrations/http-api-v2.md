# http-api-v2

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `http-api-v2`
- `actionPackageId`: `4299091f-3cd3-4d68-b198-0143575f471d`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `method`
- `url`

### Optional observed
- `body`
- `fieldPaths`
- `followRedirects`
- `followRedirectsOptions|maxRedirects`
- `headers`
- `queryString`
- `removeNull`
- `responseTimeout`
- `retryOptions|errorCodesToRetry`
- `retryOptions|maxRetries`
- `retryOptions|statusCodesToRetry`
- `returnResponseMetadata`
- `shouldRetry`

### Candidate-required observed
- `body`
- `fieldPaths`
- `followRedirects`
- `followRedirectsOptions|maxRedirects`
- `headers`
- `method`
- `queryString`
- `removeNull`
- `responseTimeout`
- `retryOptions|errorCodesToRetry`
- `retryOptions|maxRetries`
- `retryOptions|statusCodesToRetry`
- `returnResponseMetadata`
- `shouldRetry`
- `url`

## Extracted output paths observed/proven

- `Full Name (2)`
- `Result`
- `Result icy`
- `Result prospeo`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Safe public HTTP endpoint returned JSON parent fullValue with slideshow object; extracted slideshow.title visible for all checked rows.
- `proofPath` — No settings/runtime errors observed on strict proof packet.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/http-api-v2.yaml`

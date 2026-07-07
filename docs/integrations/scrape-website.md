# scrape-website

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `scrape-website`
- `actionPackageId`: `4299091f-3cd3-4d68-b198-0143575f471d`
- `actionVersion`: `1`
- Auth observed: `False`
- Run condition observed: `False`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `url`

### Optional observed
- `customRegex`
- `enableJavaScriptRendering`
- `keepNonText`
- `outputFields`
- `waitFor`

### Candidate-required observed
- `customRegex`
- `enableJavaScriptRendering`
- `keepNonText`
- `outputFields`
- `url`
- `waitFor`

## Extracted output paths observed/proven

- `Bodytext`
- `Description`
- `Extractedkeywords`
- `Keywords`
- `Title`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Clay scrape-website returned parsed web page data. Safe proof used https://example.com to avoid external target risk while proving parent shape and extracted values.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/scrape-website.yaml`

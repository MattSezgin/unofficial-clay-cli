# use-ai

## Status

- Promotion status: `battle-tested`
- Proof status: `real_data_output_verified`
- Strict battle-tested: `true`

## Action identity

- `actionKey`: `use-ai`
- `actionPackageId`: `67ba01e9-1898-4e7d-afe7-7ebe24819a57`
- `actionVersion`: `1`
- Auth observed: `True`
- Run condition observed: `True`

## Real source evidence

Evidence sections are not included in the public build. Validate against your own workspace with a <=10-row sandbox run.

## Inputs

### Required
- `prompt`
- `model`
- `useCase`
- `answerSchemaType`

### Optional observed
- `_metadata`
- `browserbaseContextId`
- `claygentFieldMapping`
- `claygentId`
- `contextDocumentIds`
- `jsonMode`
- `maxCostInCents`
- `maxTokens`
- `mcpSettings`
- `metaprompt`
- `reasoningBudget`
- `reasoningLevel`
- `runBudget`
- `stopSequence`
- `systemPrompt`
- `tableExamples`
- `temperature`
- `topP`

### Candidate-required observed
- `answerSchemaType`
- `jsonMode`
- `maxCostInCents`
- `maxTokens`
- `model`
- `prompt`
- `stopSequence`
- `systemPrompt`
- `tableExamples`
- `temperature`
- `useCase`

## Extracted output paths observed/proven

- `(upt) Normalized Job Title`
- `Company Linkedin Url`
- `Company Type`
- `Comparison Target Name`
- `Segment`
- `Functional Background Classification`
- `Is Current`
- `Linkedin Company Url`
- `Linkedin Url`
- `New Column`
- `Normalized Job Title`
- `Reasoning`
- `Referral Note`
- `Selected Option Id`
- `Size`
- `Time Taken In Seconds`
- `Total Cost To AI Provider`
- `Total Cost To AIProvider`
- `Total Input Tokens`
- `Total Output Tokens`
- `referrer_first_name`
- `referrer_last_name`
- `Example Output Field`
- `contact-linkedin-url`
- `steps`

## Proof / block summary

Strict live proof is complete: real sandbox data was run/read back, parent `externalContent.fullValue` or source materialization was inspected where applicable, extracted outputs/value QA were verified where applicable, status semantics are documented, and no unresolved proof-path settings/runtime errors remain.

## Status semantics

- `SUCCESS` — Claygent JSON Schema output returned parent fullValue JSON with persona_segment/campaign_readiness/confidence/rationale and extracted outputs were non-empty.
- `proofPath` — No settings/runtime errors observed on strict proof packet; value QA enforced explicit enums and semantic contradiction checks.

## Artifacts

- Internal run-log references are not included in the public build.

## Template

- `integration-library/templates/use-ai.yaml`

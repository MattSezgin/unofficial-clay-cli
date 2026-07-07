# Clay Integration: Apollo

## Status

Not yet observed in the current full Clay workbook exports. This is a placeholder profile so Apollo discoveries have a canonical destination instead of becoming scattered notes.

## Discovery Checklist

When a real Clay workbook/export contains Apollo actions, update:

1. `integration-library/registry.yaml`
2. this doc
3. `integration-library/templates/apollo-*.yaml`
4. CLI integration validation tests if the action has required auth/run-condition behavior

Capture from readback:

- `actionKey`
- `actionPackageId`
- `actionVersion`
- input binding names and formula shapes
- auth account type / auth requirement
- result shape and extracted output paths
- status semantics (`SUCCESS`, `SUCCESS_NO_DATA`, provider errors)
- required run-condition guards

Do not invent Apollo payloads from memory. Promote only after full export + <=10-row live sandbox proof.

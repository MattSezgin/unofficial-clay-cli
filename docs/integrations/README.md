# Clay Integration Library

This folder is the operator/developer knowledge base for turning real Clay workbook exports into reliable CLI-generated Clay tables.

## Purpose

The library prevents the CLI from guessing Clay action payloads. Every integration should have:

1. **Real-source evidence** — exported from one or more Clay workbooks via `clay-v2 workbook-export`.
2. **Required input bindings** — internal input names, not just UI labels.
3. **Auth account model** — required `appAccountTypeId`, whether Clay-managed accounts work, and when client-owned auth is needed.
4. **Action identifiers** — `actionKey`, `actionPackageId`, `actionVersion`.
5. **Output mapping** — parent action result shape and extracted output formula paths.
6. **Run conditions** — safe formulas and known blank-token pitfalls.
7. **Failure modes** — runtime errors, config/readback mismatches, and value-level QA checks.
8. **Template snippet** — machine-consumable field spec usable by `apply-spec` or future TS builders.

## Directory Structure

- `integration-library/registry.yaml` — machine-readable registry generated/updated from full workbook exports.
- `docs/integrations/*.md` — human playbooks by integration/action.
- `integration-library/templates/` — reusable YAML/TS snippets for field creation.
- `integration-library/generated/` — export-derived summaries and unknown-action discovery outputs; created locally by `onboard-workspace --update-library`, not shipped.

## Promotion Status

Every registry entry has a canonical input surface and promotion status.

Input fields:

- `requiredInputs` — curated minimum inputs the CLI validator should enforce for live specs.
- `optionalInputsObserved` — real exported inputs seen in source workbooks but not required for every generated spec.
- `candidateRequiredInputsObserved` — inputs that appeared in every observed instance for that action; useful for review, but not auto-enforced because Clay often exports default/advanced knobs.
- `inputBindingStats` — observed count/frequency/classification per binding name.

Promotion status:

- `discovered` — observed in full exports or workspace onboarding. Docs/templates may exist, but required-vs-optional inputs and runtime semantics are not fully proven.
- `reviewed` — human-reviewed against source exports; template is sane, placeholders are explicit, risks are documented, but strict live value proof is still missing or stale.
- `battle-tested` — strict proof only. The integration was created in your sandbox folder, run on real data (<=10 rows), parent `externalContent.fullValue` was inspected, extracted output fields were created from actual output keys, extracted values were visibly non-empty where expected, status/no-data/error semantics were documented, and there are no unresolved settings/runtime errors on the proof path.

`onboard-workspace --update-library` only creates or updates `discovered` entries. Never auto-promote from discovery alone. Artifact/status counts alone are not enough; red config icons, blank cells, `SUCCESS` with null values, or uninspected parent outputs must stay `reviewed`/`needs_fresh_value_level_proof`.

## Promotion Loop

1. Export source workbook:

```bash
node clay-v2.js workbook-export <workbookId> --workspace <workspaceId> --include-rows 5 \
  --out runs/<date>/full-workbook-exports/<name>-full-export.json \
  --template-out runs/<date>/full-workbook-exports/<name>-template.yaml
```

2. Inventory actions:

```bash
# Existing artifact pattern:
runs/2026-06-09/full-workbook-exports/003-action-pattern-inventory.json
```

3. Update `integration-library/registry.yaml` and `docs/integrations/<action>.md`.
4. Build a live sandbox table with <=10 rows.
5. Verify the strict proof checklist:
   - field config readback has no settings error,
   - run used real rows/data (not blank probes),
   - parent action `externalContent.fullValue` exists and was inspected,
   - extracted output fields map to actual parent output keys,
   - extracted values are visible/non-empty where expected,
   - status/no-data/error semantics are documented,
   - value-level QA catches contradictions (for example `NOT_FOUND` with high confidence),
   - no unresolved proof-path settings/runtime errors remain.
6. Only then promote a template/playbook to `battle-tested`.

## Current Known Product Bugs / Gates

- `apply-spec` must preserve JSON Schema output format; Fields mode is not acceptable by default.
- `clay-argon` + `useCase: "use-ai"` creates but fails at runtime. Clay-native models require `useCase: "claygent"`.
- Action fields need correct `inputFieldIds`; missing dependencies can make runs appear triggered without parent outputs materializing.
- Extracted output fields can show successful formula evaluation while parent action output is empty. Parent `externalContent.fullValue` is the source of truth.
- Optional blank fields in `Clay.formatForAIPrompt({{field}})` can trigger `ERROR_BLANK_TOKEN`; omit optional inputs or guard them.
- Long model matrix runs need bounded polling per field/model; do not chain multiple 600s watchers in one shell command.

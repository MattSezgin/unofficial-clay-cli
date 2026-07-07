# Playbook Schema

Playbooks are YAML files under `playbooks/`. They describe full Clay operating workflows, not only table columns.

## Required Top-Level Fields

```yaml
playbookVersion: 1
id: stable-kebab-id
name: Human Name
status: draft
purpose: >
  What this workflow accomplishes.
variables: {}
inputs: {}
sampleRows: {}
safety: {}
workflow: []
outputs: {}
knownFailureModes: []
```

Every playbook should also have a matching prompt contract:

```text
prompts/<playbook-id>.yaml
```

## Field Reference

### `playbookVersion`

Integer schema version. Current value: `1`.

### `id`

Stable kebab-case identifier. This should not change once users depend on it.

### `status`

Recommended values:

- `draft`
- `verified-sample`
- `production-ready`
- `blocked`

### `variables`

Public-safe placeholders for runtime config:

```yaml
variables:
  workspaceId: "${CLAY_WORKSPACE_ID}"
  testFolderId: "${CLAY_TEST_FOLDER_ID}"
  workbookId: "${CLAY_WORKBOOK_ID}"
```

Do not hardcode session cookies, API keys, app account IDs, workbook IDs, table IDs, view IDs, or webhook URLs in reusable playbooks.

### `inputs`

Declares required and optional user-provided columns, brief fields, or payload fields. The exact shape can vary by playbook, but required inputs must be clear enough for an agent to ask focused follow-up questions.

### `sampleRows`

Defines the sample-first gate.

```yaml
sampleRows:
  max: 10
  recommended: 5
  reason: "Why this sample size is appropriate."
```

`sampleRows.max` must be `10` or less.

### `safety`

Declares confirmation and credit boundaries.

```yaml
safety:
  requiresChatConfirmation:
    - source-import
    - action-run
    - scale-beyond-sample
  creditConsumingSteps:
    - ai_personalization
```

Every mutating, destructive, source-import, browser-capture, or credit-consuming step must appear in `requiresChatConfirmation` or be clearly covered by a broader entry.

### `workflow`

Ordered workflow steps. Each step should have:

```yaml
- id: stable_step_id
  type: formula
  description: Optional but recommended.
  runCondition: Optional Clay formula or playbook condition.
  outputs:
    - output_field
```

The workflow should be specific enough that an agent can translate it into Clay specs or CLI commands without inventing the operating sequence.

### `firstRunGate`

Optional but strongly recommended. Lists what must be inspected after the sample run and the pass criteria before scale.

### `scaleGate`

Optional. Use when a workflow has a distinct scale-up stage after source previews or sample runs.

### `outputs`

Declares ready columns, QA views, and artifacts.

```yaml
outputs:
  readyColumns:
    - verified_email
  qaViews:
    - ready_to_export
    - needs_manual_review
```

### `knownFailureModes`

Plain-language risk list. This must not be empty.

## Validation

Run:

```bash
npm run test:playbooks
npm run test:prompts
npm run test:intake
npm run test:plan
```

Route a user request before planning:

```bash
node intake-request.js \
  --request "Find people at these companies by job title" \
  --out runs/YYYY-MM-DD/people-from-companies-intake.json
```

The intake artifact should identify the selected playbook, alternatives, ambiguity status, missing required inputs, and next offline commands. It should not contain client row data or secrets.

Generate an offline plan:

```bash
node plan-playbook.js playbooks/outbound-personalization.yaml \
  --inputs examples/outbound-personalization-input.example.yaml \
  --spec specs/templates/outbound-personalization.yaml \
  --json
```

The generated plan includes a `generatedSpecPlan` section with:

- a `promptContract` summary for the matching `prompts/<playbook-id>.yaml`
- required and optional input bindings by key and section, with values omitted
- one template plan per discovered `specs/templates/` file
- offline validation commands
- live sample commands labeled with `confirmationRequired: true`
- the sample-first quality loop before scale

To write one selected template execution plan:

```bash
node plan-playbook.js playbooks/people-from-companies.yaml \
  --inputs examples/people-from-companies-input.example.yaml \
  --template-plan people-from-companies-company-stage.yaml \
  --out runs/YYYY-MM-DD/people-from-companies-company-stage-plan.json
```

`--template-plan` accepts the template path, template basename, or a 1-based index from `generatedSpecPlan.templatePlans`.

To write a confirmation-ready sample-run packet:

```bash
node plan-playbook.js playbooks/outbound-personalization.yaml \
  --inputs examples/outbound-personalization-input.example.yaml \
  --sample-run outbound-personalization.yaml \
  --out runs/YYYY-MM-DD/outbound-personalization-sample-run.json
```

The sample-run packet is still offline. It separates:

- prompt-contract metadata, guardrails, output fields, and QA checks
- offline commands
- live Clay commands that require exact chat confirmation
- readback commands
- confirmation prompt text
- runtime requirements such as `CLAY_WORKSPACE_ID`, `CLAY_TEST_FOLDER_ID`, `CLAY_WORKBOOK_ID`, and sandbox workbook preflight checks
- stop conditions
- quality-report command scaffold

`apply-spec` rejects unresolved `${...}` placeholders at live execution time. Provide safe env vars or explicit `--workspace` / `--folder` / `--workbook` overrides before asking for confirmation.

Preflight a packet:

```bash
node preflight-sample-run.js runs/YYYY-MM-DD/outbound-personalization-sample-run.json \
  --workspace TEST_WS \
  --folder <sandbox-folder-id> \
  --workbook <sandbox-workbook-id> \
  --out runs/YYYY-MM-DD/outbound-personalization-preflight.json
```

`readiness.readyForFirstLiveCommand` can be true while `readiness.readyForAllLiveCommands` remains false. That is expected when later commands need table/view IDs from readback.

After `apply-spec` returns table/view IDs, hydrate the packet:

```bash
node hydrate-sample-run.js runs/YYYY-MM-DD/outbound-personalization-sample-run.json \
  --apply-result runs/YYYY-MM-DD/outbound-personalization-apply-result.json \
  --out runs/YYYY-MM-DD/outbound-personalization-hydrated-sample-run.json
```

`hydrate-sample-run.js` removes completed live commands, replaces placeholders such as `<sample-table>` and `<sample-view>`, and leaves the next live command ready for preflight.

Fill a quality report from ignored evidence:

```bash
node collect-evidence.js \
  --apply runs/YYYY-MM-DD/outbound-personalization-apply-result.json \
  --preflight runs/YYYY-MM-DD/outbound-personalization-preflight.json \
  --hydrated-preflight runs/YYYY-MM-DD/outbound-personalization-hydrated-preflight.json \
  --verify runs/YYYY-MM-DD/outbound-personalization-verify.json \
  --manifest runs/YYYY-MM-DD/outbound-personalization-manifest-redacted.json \
  --out runs/YYYY-MM-DD/outbound-personalization-evidence.json

node quality-report.js runs/YYYY-MM-DD/outbound-personalization-plan.json \
  --evidence runs/YYYY-MM-DD/outbound-personalization-evidence.json \
  --out runs/YYYY-MM-DD/outbound-personalization-quality-report.md
```

Evidence files may include live IDs and command strings, so keep them under ignored `runs/`.

Every playbook should have a matching example input named:

```text
examples/<playbook-id>-input.example.yaml
```

Examples should use public-safe column labels, synthetic brief text, synthetic webhook payloads, or `${PLACEHOLDER}` parameters. They should not contain live table IDs, view IDs, webhook URLs, app-account IDs, customer data, or secrets.

The validator checks:

- required fields exist
- `sampleRows.max <= 10`
- each playbook has a public-safe matching prompt contract under `prompts/`
- each playbook has safety confirmations, workflow steps, outputs, and failure modes
- playbooks do not contain secret-looking or private ID patterns
- each playbook's offline plan discovers at least one matching spec template under `specs/templates/`
- each playbook has an example input that satisfies required inputs without leaking example values into generated plans
- each generated spec plan has prompt metadata, input bindings, template plans, offline validation commands, and confirmation-gated live sample commands

Run the full offline gate before live Clay work:

```bash
npm run test:all
```

## Public-Safe ID Rule

Reusable playbooks must not contain raw IDs matching:

- `aa_...` app account IDs
- `wb_...` workbook IDs
- `t_...` table IDs
- `gv_...` view IDs
- `f_...` field IDs

Use variables instead. Internal run artifacts may include these IDs if they are ignored and redacted before being shared.

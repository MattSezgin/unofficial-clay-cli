# Clay Operator Runbook

Use this runbook to map a user request to a safe Clay CLI playbook.

## First Principles

- Start with the playbook, not a raw command.
- Use sample rows first: 1 for webhook, 5-10 for sources/actions.
- Readback is truth.
- Every Clay write/import/run/source-preview requires explicit chat confirmation for that exact command.
- Keep all live testing inside the configured test workspace/folder unless the operator explicitly changes the boundary.

## Request Routing

| User Request | Playbook |
|---|---|
| "Find people at these companies/titles" | `playbooks/people-from-companies.yaml` |
| "Build a campaign personalization table" | `playbooks/outbound-personalization.yaml` |
| "Source a list from an ICP brief" | `playbooks/source-to-ready-list.yaml` |
| "Enrich emails/phones and verify them" | `playbooks/email-phone-waterfall.yaml` |
| "Clean/enrich CRM export for import" | `playbooks/crm-enrichment-export.yaml` |
| "Create a webhook enrichment endpoint" | `playbooks/webhook-enrichment.yaml` |
| "Audit/clone/fix an existing Clay table" | `playbooks/table-audit-clone.yaml` |
| "Check campaign status before adding leads to an outbound campaign" | `playbooks/campaign-activation-with-status-lookup.yaml` |
| "Enrich conference attendee rows into verified person/company identities" | `playbooks/conference-attendee-identity-enrichment.yaml` |
| "Identify accounts likely using or evaluating a target CRM/GTM tool" | `playbooks/crm-usage-intent.yaml` |
| "Find and verify founder contacts with a work-email waterfall" | `playbooks/founder-contact-waterfall.yaml` |
| "Source lookalike companies and run role-based people searches" | `playbooks/lookalike-to-role-based-people-search.yaml` |

## Prompt Contracts

Use `prompt-library.js` to inspect reusable public-safe prompt contracts before configuring AI fields:

```bash
node prompt-library.js --list --json
node prompt-library.js --playbook <playbook-id> --json
```

Prompt contracts live in `prompts/`. They contain guardrails, task instructions, output schemas, and QA checks only; runtime row values and client-specific prompt edits stay in ignored local artifacts.

## Standard Operating Loop

0. Optional: exercise the full offline control plane with simulated IDs:
   ```bash
   node simulate-full-loop.js \
     --request "Build a campaign personalization table" \
     --inputs examples/outbound-personalization-input.example.yaml \
     --config config.example.yaml \
     --profile yourTestProfile \
     --workspace TEST_WS \
     --folder <sandbox-folder-id> \
     --workbook <sandbox-workbook-id> \
     --out-dir runs/<date>/<playbook-id>-simulation \
     --json
   ```
   This creates fake apply/verify/manifest evidence and a fake scale gate. Use it only to test the control plane; it does not prove Clay worked.
   Run the read-only completion audit after simulation if you need to prove the goal is still incomplete:
   ```bash
   node completion-audit.js \
     --simulation runs/<date>/<playbook-id>-simulation/<playbook-id>-full-loop-simulation.json \
     --json
   ```
1. Prepare the offline sample-run bundle:
   ```bash
   node prepare-sample-run.js \
     --request "Build a campaign personalization table" \
     --inputs examples/outbound-personalization-input.example.yaml \
     --config config.example.yaml \
     --profile yourTestProfile \
     --workspace TEST_WS \
     --folder <sandbox-folder-id> \
     --workbook <sandbox-workbook-id> \
     --out-dir runs/<date>/<playbook-id> \
     --json
   ```
   Inspect `readiness.status`, `issues`, `artifacts`, and `nextAction`. Ask for live-command confirmation only when `readiness.status` is `ready_for_first_live_command_confirmation`.
2. If the prepare bundle is not ready, route the natural-language request and identify missing inputs manually:
   ```bash
   node intake-request.js \
     --request "Find people at these companies by job title" \
     --out runs/<date>/<playbook-id>-intake.json
   ```
   Inspect `routing.selectedPlaybook`, `routing.alternatives`, `routing.ambiguity`, `inputSummary`, and `missingInputQuestions`. If `routing.ambiguity` is `review-required`, ask a focused clarification before generating a plan. Use `profile-context.js` when checking runtime profile values so raw workbook/folder IDs do not leak into committed notes.
3. Read the selected playbook.
4. Read the matching prompt contract with `node prompt-library.js --playbook <playbook-id> --json`.
5. Resolve required inputs in an ignored local input file or a public-safe example file.
6. Generate an offline plan:
   ```bash
   node plan-playbook.js playbooks/<playbook-id>.yaml --inputs examples/<playbook-id>-input.example.yaml --json
   ```
   Inspect `generatedSpecPlan` for input bindings, selected templates, offline validation commands, and confirmation-gated live sample commands.
   To write one selected template execution plan under ignored `runs/`:
   ```bash
   node plan-playbook.js playbooks/<playbook-id>.yaml \
     --inputs examples/<playbook-id>-input.example.yaml \
     --template-plan <template-basename-or-index> \
     --out runs/<date>/<playbook-id>-template-plan.json
   ```
   To write a confirmation-ready sample-run packet:
   ```bash
   node plan-playbook.js playbooks/<playbook-id>.yaml \
     --inputs examples/<playbook-id>-input.example.yaml \
     --sample-run <template-basename-or-index> \
     --out runs/<date>/<playbook-id>-sample-run.json
   ```
   The packet separates offline commands, exact live Clay commands that need chat confirmation, readback commands, and stop conditions.
   Validate the operator config/profile before preflight:
   ```bash
   node profile-context.js config.example.yaml \
     --profile yourTestProfile \
     --require-resolved \
     --workspace TEST_WS \
     --folder <sandbox-folder-id> \
     --workbook <sandbox-workbook-id> \
     --json

   node validate-config.js config.example.yaml \
     --profile yourTestProfile \
     --require-resolved \
     --require-test-profile \
     --workspace TEST_WS \
     --folder <sandbox-folder-id> \
     --workbook <sandbox-workbook-id>
   ```
   Preflight the packet before asking for confirmation:
   ```bash
   node preflight-sample-run.js runs/<date>/<playbook-id>-sample-run.json \
     --config config.example.yaml \
     --profile yourTestProfile \
     --workspace TEST_WS \
     --folder <sandbox-folder-id> \
     --workbook <sandbox-workbook-id> \
     --out runs/<date>/<playbook-id>-preflight.json
   ```
   Ask for confirmation only when `readiness.readyForFirstLiveCommand` is true. Do not run later live commands until readback has replaced placeholders like `<sample-table>` and `<sample-view>`.
7. Build or validate an offline spec/template.
   ```bash
   npm run test:all
   ```
8. Confirm configured workspace/folder.
   For `apply-spec`, `CLAY_WORKSPACE_ID` and `CLAY_WORKBOOK_ID` must resolve before the command runs. For sandbox testing, the workbook must be inside your sandbox folder.
9. Preview/dry-run where available.
10. Ask for explicit chat confirmation before any `--confirm`.
11. Create/import only sample rows.
   After `apply-spec` succeeds, hydrate the sample-run packet with the returned table/view IDs:
   ```bash
   node advance-sample-run.js \
     --prepared runs/<date>/<playbook-id>/<playbook-id>-prepared-sample-run.json \
     --apply-result runs/<date>/<playbook-id>-apply-result.json \
     --config config.example.yaml \
     --profile yourTestProfile \
     --workspace TEST_WS \
     --folder <sandbox-folder-id> \
     --workbook <sandbox-workbook-id> \
     --out-dir runs/<date>/<playbook-id> \
     --json
   ```
   This writes the hydrated sample-run packet and hydrated preflight. Ask for the next live command confirmation only when `readiness.status` is `ready_for_next_live_command_confirmation`.
11. Run only first 10 or fewer credit-consuming rows.
12. Export/readback/verify the result.
   Collect ignored evidence from the run artifacts:
   ```bash
   node collect-evidence.js \
     --apply runs/<date>/<playbook-id>-apply-result.json \
     --preflight runs/<date>/<playbook-id>-preflight.json \
     --hydrated-preflight runs/<date>/<playbook-id>-hydrated-preflight.json \
     --verify runs/<date>/<playbook-id>-verify.json \
     --manifest runs/<date>/<playbook-id>-manifest-redacted.json \
     --out runs/<date>/<playbook-id>-evidence.json
   ```
   Or rerun `advance-sample-run.js` with `--verify`, `--manifest`, and `--counts` to write hydrated preflight, evidence, and report artifacts together.
13. Produce a continue/stop recommendation:
   ```bash
   node quality-report.js <plan.json> --out <sample-quality-report.md>
   ```
   The generated report includes spec-template evidence, confirmation-required phase labels, first-run gate checks, and scale-gate requirements.
   To fill the report from ignored run evidence:
   ```bash
   node quality-report.js runs/<date>/<playbook-id>-plan.json \
     --evidence runs/<date>/<playbook-id>-evidence.json \
     --out runs/<date>/<playbook-id>-quality-report.md
   ```
14. Scale only after a second explicit confirmation.
   Generate the offline scale gate first:
   ```bash
   node scale-gate.js \
     --plan runs/<date>/<playbook-id>-plan.json \
     --evidence runs/<date>/<playbook-id>-evidence.json \
     --command '<exact Clay scale command with --confirm>' \
     --quality-reviewed true \
     --out runs/<date>/<playbook-id>-scale-gate.json
   ```
   Ask for the second confirmation only when `readiness.status` is `ready_for_second_scale_confirmation`. Use the artifact's `confirmationPrompt`; do not summarize or alter the command.
15. Audit completion before claiming the package goal is done:
   ```bash
   node completion-audit.js \
     --prepared runs/<date>/<playbook-id>/<playbook-id>-prepared-sample-run.json \
     --apply-result runs/<date>/<playbook-id>/<playbook-id>-apply-result.json \
     --advanced runs/<date>/<playbook-id>/<playbook-id>-advanced-sample-run.json \
     --evidence runs/<date>/<playbook-id>/<playbook-id>-evidence.json \
     --quality-report runs/<date>/<playbook-id>/<playbook-id>-quality-report.md \
     --scale-gate runs/<date>/<playbook-id>/<playbook-id>-scale-gate.json \
     --json
   ```
   Simulated or missing artifacts must leave the audit at `not_complete`. A prepared manifest without a non-simulated apply result is readiness evidence only, not sample-build proof.

## Quality Report Template

```md
## Sample Result

- Rows tested:
- Credit-consuming fields run:
- Success count:
- Error count:
- Manual review count:
- Ready count:

## Evidence

- Table:
- View:
- Verification command:
- Artifact paths:

## Continue / Stop

Recommendation:
Reason:
Required fixes before scale:
```

## Public Repo Checklist

Before copying this tool out of the private workspace:

- Remove ignored runtime artifacts.
- Remove raw Clay session files.
- Remove private raw manifests and screenshots.
- Keep `config.example.yaml`; do not copy local profile files.
- Keep only public-safe `examples/*-input.example.yaml`; do not copy client row data.
- Run `npm run check`, `npm run smoke:validate`, `npm run test:redaction`, `npm run test:playbooks`, `npm run test:intake`, `npm run test:scale`, `npm run test:simulate`, `npm run test:audit`, `npm run test:profile`, and `npm run test:config`.
- Prefer `npm run test:all` for the full offline gate.
- Search for private IDs and secrets:
  - `claysession`
  - `apiToken`
  - `Bearer`
  - `sk-`
  - `aa_`
  - `wb_`
  - `t_`
  - `gv_`
  - Clay webhook URLs
  - Slack webhook URLs

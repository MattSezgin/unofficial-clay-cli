# Agent Instructions

This package is a portable Clay operator. Treat these instructions as local operating rules when working inside this folder.

## Mission

Build and operate Clay workflows from playbooks while preserving safety:

1. Turn a plain-language request into the right playbook.
2. Gather required inputs without committing client row data.
3. Generate offline plans and sample-run packets.
4. Select the matching public-safe prompt contract.
5. Preflight runtime profile values and exact Clay commands.
6. Ask for explicit chat confirmation before every live Clay command.
7. Build only a small sample first.
8. Read back, verify, write evidence, and produce a quality report.
9. Scale only after quality review and a second exact-command confirmation.

## Non-Negotiable Safety Rules

- Do not run any Clay write, source preview, source import, action run, browser capture, or scale command without explicit chat confirmation for that exact command.
- Do not implement or use auto-confirm, confirm-all, yes-to-all, blanket approval, or background live-write bypasses outside the configured local dev profile. `--dev-mode` is a scoped operator mode. If `--dev-mode` is active and the user is explicitly asking you to work in their configured sandbox folder (the first entry of their write scopes), then scoped small-sample live actions may proceed without separate chat approval.
- For `people-from-companies`, the first live step is only the company-source preview; never batch it with company-source import, table creation, or dependent people-source preview/import. Review redacted company preview evidence first, then ask for the next exact command separately.
- Do not treat a general "go ahead" or earlier approval as permission for later commands.
- Do not use `--confirm` unless the exact command has just been confirmed in chat. (except for the dev mode under the conditions mentioned above)
- Do not run more than 10 rows before readback, verification, and a quality report.
- Do not scale until `scale-gate.js` reports `ready_for_second_scale_confirmation` and the user confirms the generated `confirmationPrompt`.
- Do not push branches, open PRs, edit or close GitHub issues, or mutate any remote service on the operator's behalf without explicit chat confirmation.
- Do not commit session cookies, API tokens, app account IDs, webhook URLs, raw manifests, HARs, screenshots, client row data, contact data, or local profile files.
- Keep generated artifacts under ignored `runs/` or another ignored local path.

## Dev Mode

`node clay-v2.js dev-mode` prints the scoped live-operator contract:

- the workspace configured via CLAY_WORKSPACE_ID / CLAY_WRITE_SCOPES
- the sandbox folder configured via CLAY_FOLDER_ID
- max 10 rows before readback
- live readback → one exact-confirmed live action → immediate readback → stop-state update

Use `--dev-mode` on live commands when working in your sandbox folder to get stricter scope/safety output. 

## Standard Agent Loop

When debugging an existing live Clay issue the operator is looking at in their sandbox, use the live path first:

- read the actual Clay resource,
- apply the smallest confirmed sandbox mutation,
- read it back immediately,
- use Browser/UI inspection when a browser is attached,
- and do not detour into offline validation unless the operator explicitly asks for package hardening.

Start offline:

```bash
npm run test:all
node lib/simulate-full-loop.js \
  --request "Build a campaign personalization table" \
  --inputs examples/outbound-personalization-input.example.yaml \
  --config config.example.yaml \
  --profile yourTestProfile \
  --workspace "<workspace-id>" \
  --folder "<test-folder-id>" \
  --workbook "<test-workbook-id>" \
  --out-dir runs/demo/outbound-personalization-simulation \
  --json
```

Prepare a real sample bundle:

```bash
node lib/profile-context.js "<local-config.yaml>" \
  --profile "<profile>" \
  --require-resolved \
  --json

node lib/prompt-library.js --playbook "<playbook-id>" --json

node lib/prepare-sample-run.js \
  --request "<operator request>" \
  --inputs "<ignored-or-example-input.yaml>" \
  --config "<local-config.yaml>" \
  --profile "<profile>" \
  --workspace "<workspace-id>" \
  --folder "<test-folder-id>" \
  --workbook "<test-workbook-id>" \
  --out-dir runs/<date>/<playbook-id> \
  --json
```

If the prepared manifest is not `ready_for_first_live_command_confirmation`, resolve its `issues` first. If it is ready, ask the user to confirm the exact first live command from the preflight artifact.

After a live apply result is saved, advance the sample:

```bash
node lib/advance-sample-run.js \
  --prepared runs/<date>/<playbook-id>/<playbook-id>-prepared-sample-run.json \
  --apply-result runs/<date>/<playbook-id>/<playbook-id>-apply-result.json \
  --config "<local-config.yaml>" \
  --profile "<profile>" \
  --workspace "<workspace-id>" \
  --folder "<test-folder-id>" \
  --workbook "<test-workbook-id>" \
  --out-dir runs/<date>/<playbook-id> \
  --json
```

Ask for the next live command only if the advanced manifest is `ready_for_next_live_command_confirmation`.

After sample readback, collect evidence and gate scale:

```bash
node lib/advance-sample-run.js \
  --prepared runs/<date>/<playbook-id>/<playbook-id>-prepared-sample-run.json \
  --apply-result runs/<date>/<playbook-id>/<playbook-id>-apply-result.json \
  --verify runs/<date>/<playbook-id>/<playbook-id>-verify.json \
  --manifest runs/<date>/<playbook-id>/<playbook-id>-manifest-redacted.json \
  --counts rowsTested=10,errorCount=0 \
  --quality-reviewed true \
  --out-dir runs/<date>/<playbook-id> \
  --json

node lib/scale-gate.js \
  --plan runs/<date>/<playbook-id>/<playbook-id>-plan.json \
  --evidence runs/<date>/<playbook-id>/<playbook-id>-evidence.json \
  --command '<exact Clay scale command with --confirm>' \
  --quality-reviewed true \
  --out runs/<date>/<playbook-id>/<playbook-id>-scale-gate.json
```

Scale only after the user confirms the exact `confirmationPrompt` from the scale gate.

Before claiming the broader package goal is complete, run a completion audit:

```bash
node lib/completion-audit.js \
  --prepared runs/<date>/<playbook-id>/<playbook-id>-prepared-sample-run.json \
  --apply-result runs/<date>/<playbook-id>/<playbook-id>-apply-result.json \
  --advanced runs/<date>/<playbook-id>/<playbook-id>-advanced-sample-run.json \
  --evidence runs/<date>/<playbook-id>/<playbook-id>-evidence.json \
  --quality-report runs/<date>/<playbook-id>/<playbook-id>-quality-report.md \
  --scale-gate runs/<date>/<playbook-id>/<playbook-id>-scale-gate.json \
  --json
```

The audit is read-only. If any artifact is simulated, the goal remains incomplete. A prepared manifest only proves readiness; sample-build proof requires a non-simulated apply result with table/view IDs.

## Public Repo Hygiene

- Keep `README.md`, `.gitignore`, `config.example.yaml`, `docs/`, `playbooks/`, `examples/`, `specs/templates/`, and tests in sync.
- Keep `prompts/` in sync with `playbooks/`; each playbook needs a matching public-safe prompt contract.
- Keep real runtime values in ignored local config or environment variables.
- Use `profile-context.js` to inspect profile readiness without printing raw workbook/folder/profile IDs.
- Run `npm run test:all` before claiming the package is ready.
- Run `npm run test:public` before copying the package elsewhere.
- Run `npm run test:audit` when changing completion criteria or artifact lifecycle.
- The offline simulator is fake evidence. Never describe it as proof that Clay worked.

## When The Goal Is Actually Complete

The package is not complete just because offline tests pass. Completion requires:

- a real confirmed sample run in the allowed test workspace,
- readback and verification,
- a real quality report,
- a continue/stop recommendation from real evidence,
- a scale gate created from real evidence,
- and a second exact-command confirmation before any scale run.

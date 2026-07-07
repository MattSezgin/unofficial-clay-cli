---
name: clay-run-playbook
description: Run a full Clay playbook end to end - intake, plan, prepare, sample, verify, scale - use when a plain-language request should be routed to one of the 12 packaged playbooks and operated through to a safe scale decision, not just a single ad-hoc command.
---

# clay-run-playbook

This is the full ten-step loop the package is built around: turn a plain-language
request into a playbook, prepare and preflight it, run one small confirmed sample,
verify it, then only scale after a second explicit confirmation. Every step below is a
standalone script (`node <script>.js ...`); none of them silently chain past a
confirmation gate.

## The loop, in order

**1. Intake** - route the request to a playbook and see what inputs are missing:

```bash
node intake-request.js --request "Find work emails for a list of companies" --inputs input.yaml --out intake.json
```

**2. Plan** - build an offline, public-safe plan (steps, input coverage, matched prompt
contract, spec templates):

```bash
node plan-playbook.js playbooks/email-phone-waterfall.yaml --inputs input.yaml --out plan.yaml
```

**3. Simulate (optional)** - an offline demo of the whole loop with fake artifacts, to
prove the control plane is wired before touching live Clay:

```bash
node simulate-full-loop.js --request "..." --inputs examples/email-phone-waterfall-input.example.yaml --config config.example.yaml --profile default --out-dir runs/demo
```

`completion-audit.js` (step 10) correctly reports `not_complete` on simulated
artifacts - simulation proves the harness, not live proof.

**4. Prepare + preflight** - wraps intake + plan + config validation + preflight into
one packet; status must reach `ready_for_first_live_command_confirmation`:

```bash
node prepare-sample-run.js --request "..." --inputs input.yaml --config config.local.yaml --profile default --out-dir runs/2026-01-01/email-phone-waterfall
```

**5. First live command (human-confirmed, exact)** - typically
`node clay-v2.js apply-spec ... --confirm` or `source-preview ... --dev-mode`. Ask for
and get exact-command chat confirmation before running it; save the result JSON as the
apply-result artifact.

**6. Hydrate / advance** - merge the live result back into the packet and move state
forward:

```bash
node hydrate-sample-run.js sample-run.json --apply-result apply-result.json --out hydrated.json
node advance-sample-run.js --prepared prepared.json --apply-result apply-result.json --out-dir runs/2026-01-01/email-phone-waterfall
```

Each `advance-sample-run.js` call gates the *next* live command behind
`ready_for_next_live_command_confirmation`.

**7. Sample + readback** - run at most 10 rows (`node clay-v2.js run-top ... --confirm`,
see `/clay-run-enrichment`), then read back with `verify-table` / `proof-readback` /
`manifest`.

**8. Evidence + quality gate** - rerun advance with verification counts, which builds
evidence and renders the quality report:

```bash
node advance-sample-run.js --prepared prepared.json --apply-result apply-result.json \
  --verify verify.json --manifest manifest.json --counts rowsTested=10,errorCount=0 \
  --quality-reviewed true --out-dir runs/2026-01-01/email-phone-waterfall

node workbook-parity.js --fixture fixture.json --require-rows
```

You can also assemble an evidence bundle directly with
`node collect-evidence.js --apply apply-result.json --verify verify.json --manifest manifest.json --counts rowsTested=10,errorCount=0 --out evidence.json`,
and render a standalone markdown report with `node quality-report.js plan.yaml --out report.md`.

**9. Scale gate** - the second confirmation checkpoint. Only proceeds to
`ready_for_second_scale_confirmation` with real evidence, a quality-reviewed flag, and
the exact scale command:

```bash
node scale-gate.js --evidence evidence.json --workbook-parity parity.json --plan plan.json \
  --command "node clay-v2.js run-top t_TEST_TABLE --field f_TEST_FIELD --view gv_TEST_VIEW --n 10 --confirm" \
  --quality-reviewed true --out scale-gate.json
```

Do not run the scale command until the operator has confirmed the exact
`confirmationPrompt` this script prints - that is the second of the two required
confirmations (the first was step 5's live command). A real scale run may legitimately
need more than 10 rows (`run-top` refuses anything above 10 unless
`--allow-more-than-10` is also passed) - whatever the number, put the literal command
in front of the operator and get it approved before it runs, the same as every other
confirmed command in this loop.

**10. Completion audit** - read-only check across every artifact; simulated or missing
live proof reports `not_complete`:

```bash
node completion-audit.js --prepared prepared.json --apply-result apply-result.json \
  --advanced advanced.json --evidence evidence.json --quality-report report.md \
  --scale-gate scale-gate.json --workbook-parity parity.json --json
```

## The two-confirmation safety contract

1. **First live command confirmation** (step 5) - the exact first Clay write/preview
   command, approved in chat before `--confirm` is used.
2. **Second scale confirmation** (step 9) - only after real sample evidence, a
   reviewed quality report, and workbook parity check, approved against the exact
   scale command `scale-gate.js` prints.

Never treat an earlier "go ahead" as covering a later command. Never batch multiple
`--confirm` calls behind one approval - each exact command gets its own.

## Playbooks available

`playbooks/*.yaml` (12, each with a matching `prompts/<id>.yaml` contract and
`examples/<id>-input.example.yaml`): `campaign-activation-with-status-lookup`,
`conference-attendee-identity-enrichment`, `crm-enrichment-export`, `crm-usage-intent`,
`email-phone-waterfall`, `founder-contact-waterfall`,
`lookalike-to-role-based-people-search`, `outbound-personalization`,
`people-from-companies`, `source-to-ready-list`, `table-audit-clone`,
`webhook-enrichment`.

## Gotchas

- `people-from-companies`: the first live step is the company-source preview only -
  never chain company-source import, table creation, or a dependent people-source
  preview/import into the same confirmation.
- `--dev-mode` may skip the separate chat-approval step only inside the configured
  sandbox workspace/folder from `/clay-onboarding` - it never removes the two-gate
  structure itself, just who has to click go inside that one sandbox.
- `prompt-library.js` lists/shows the public-safe prompt contracts these playbooks use:
  `node prompt-library.js --list` or `node prompt-library.js --playbook email-phone-waterfall`.

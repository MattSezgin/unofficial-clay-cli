<div align="center">

# unofficial-clay-cli

**Run Clay from your terminal or your AI agent - safely.**

50 CLI commands, a declarative playbook system, a community template library with a voted leaderboard, and safety gates that make it very hard to burn credits or leak secrets.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![Claude Code ready](https://img.shields.io/badge/Claude%20Code-10%20skills-blueviolet)](.claude/skills/)
[![Safety gate](https://img.shields.io/badge/every%20PR-secret%20scanned-blue)](SECURITY.md)

*Not affiliated with or endorsed by Clay. This is an independent, community-maintained toolkit that talks to Clay's internal v3 API - it can break when Clay changes things.*

</div>

---

## Top community workflows

<!-- LEADERBOARD:START -->
| # | Workflow | Category | Author | Votes |
|---|----------|----------|--------|-------|
| 1 | [Work Email Waterfall](community/templates/work-email-waterfall/) | `enrichment` | [Matt Sezgin](community/contributors/MattSezgin/) | [0 votes](https://github.com/MattSezgin/unofficial-clay-cli/discussions/1) |

*Vote with a thumbs-up on a workflow's discussion thread. Updated automatically.*
<!-- LEADERBOARD:END -->

Want your workflow (and your name) up there? **[Share one in ~5 minutes](CONTRIBUTING.md)** - a guided wizard rebuilds it as a clean template, you get a contributor profile page, and thumbs-up votes rank it here.

---

## What you get

| The CLI | Playbooks | Community | Safety |
|---------|-----------|-----------|--------|
| 50 commands over tables, fields, sources, enrichment runs, and workbooks - plus a second lightweight client and a full-fidelity workbook exporter | Describe a table build declaratively in YAML, validate it offline, diff it against reality, apply it with a dry-run first | Voted workflow templates with contributor profiles - install other people's proven Clay patterns | Dry-run defaults, confirm gates on every write, 10-row sample caps, sandbox scoping, and a secret scanner on every push |

## Quickstart

```bash
git clone https://github.com/MattSezgin/unofficial-clay-cli.git
cd unofficial-clay-cli
npm install

# auth: put your Clay login in .env (used only to mint a local session)
cp .env.example .env        # then edit: CLAY_EMAIL=... CLAY_PASSWORD=...

# tell the CLI which workspace is yours (the number in your Clay app URL)
export CLAY_WORKSPACE_ID=123456
# optional but recommended: restrict writes to one sandbox folder
export CLAY_FOLDER_ID=f_TEST_FOLDER

# first command - read-only, no credits, proves auth works
node clay-api.js workspaces
```

Using Claude Code or another AI agent? Open this repo and ask it to run the **clay-onboarding** skill - it walks the whole setup interactively. Every command family has a skill in [`.claude/skills/`](.claude/skills/).

## The safety model (read this once)

This tool can spend your Clay credits and write to your tables, so it is paranoid by default:

- **Nothing real ships with the repo, ever.** Your session lives outside the repo folder; run artifacts land in git-ignored `runs/`; the repo bans the very *shape* of real Clay IDs in CI.
- **Every write needs `--confirm`**, and the convention is dry-run first. Enrichment runs are capped at 10 rows (`run-top --n 10`) until you have verified output quality.
- **Writes are scoped.** The CLI refuses to write outside the workspace/folder you configured (`CLAY_WORKSPACE_ID` / `CLAY_FOLDER_ID` / `CLAY_WRITE_SCOPES`).
- **Sharing cannot leak.** Community templates are schema-validated forms with no field a secret can fit in, built by a wizard that rebuilds (never copies) your workflow and shows you exactly what will be published. Details: [SECURITY.md](SECURITY.md).

## The pieces

| Piece | Where | What it does |
|-------|-------|--------------|
| Main CLI | `clay-v2.js` | Tables, fields, views, records, sources, enrichment runs, declarative specs - `node clay-v2.js help` |
| Lightweight client | `clay-api.js` | 35 quick read/write commands + a require-able `ClayAPI` class |
| Full exporter | `full_export.py` | Every row of every table in a workbook, including full AI/action column payloads |
| Playbook lifecycle | `intake-request.js` -> `plan-playbook.js` -> `prepare-sample-run.js` -> ... -> `completion-audit.js` | A disciplined operator loop: plan offline, confirm one live command at a time, verify with evidence |
| Integration library | `integration-library/` | 40 Clay actions with observed input bindings, statuses, and battle-test verdicts |
| Community templates | `community/` | Shared workflow templates + contributor profiles + the leaderboard |
| Safety tooling | `scripts/scan-repo.js`, `scripts/validate-community.js` | The gates that keep secrets and real IDs out - run locally any time |

*Vocabulary, once: a **playbook** is a step-by-step recipe for building a Clay table. A **spec** is the YAML description of a table - a blueprint you can validate before building. A **readback** is a fresh read from Clay after a change - the readback is the truth, not the command output.*

*Two ways to configure: bare env vars (the quickstart above) work everywhere; the playbook lifecycle scripts can also read named profiles from a config file - copy `config.example.yaml` and see the operator runbook in `docs/`.*

## Claude Code skills

| Skill | Use it to |
|-------|-----------|
| `clay-onboarding` | Set up auth, workspace scope, and your first read-only command |
| `clay-explore` | Explore workspaces, tables, credits, and schemas - read-only |
| `clay-build-table` | Build tables declaratively with spec validate/diff/apply |
| `clay-build-lists` | Build people/company lists and webhook sources |
| `clay-run-enrichment` | Run enrichments on 10-row samples and verify output quality |
| `clay-run-playbook` | Drive the full plan -> sample -> scale lifecycle |
| `clay-browse-actions` | Discover and evaluate Clay actions |
| `clay-export` | Export full workbooks safely |
| `clay-share-workflow` | Share a workflow to the community leaderboard |
| `clay-security-guide` | Learn the leak vectors and how to respond to incidents |

## Live-behavior notes and current limits

Honest capability notes, enforced by the test suite so the docs cannot drift from the code:

- **Webhook Sources**: `create-webhook-source` adds a webhook source to a table. Duplicate webhook sources are refused unless you explicitly pass `--allow-duplicate-webhook`.
- **Real Workbook Parity Fixtures**: `workbook-fixture` extracts a redacted manifest from a known-good workbook; `workbook-export` captures full structure. Parity checks compare functional structure, not just row counts.
- **Workspace onboarding**: `onboard-workspace` inventories the actions observed in your workbooks and can update `integration-library/registry.yaml` with `--update-library`.
- **Select cell writes are not supported yet** by the verified records API path - `--allow-select-write` exists only for live probes and can produce phantom values; avoid it in production flows.
- **View sort/filter updates are not supported yet** - configure sorts/filters in the Clay UI.
- Field and status readbacks can show internal names (`api=...`) that differ from the labels you see in the Clay UI - always trust the readback.
- **Primitive source/import proof is not the same as a real Clay workbook** - a command succeeding once is not evidence your production table is configured correctly. Verify with live readback (see the playbook lifecycle).

## Contributing

Workflow templates are the heart of this repo - [CONTRIBUTING.md](CONTRIBUTING.md) has the 5-minute path. Code PRs welcome too; every PR runs the offline test battery plus the safety gate.

## License

MIT - built and maintained by [Matt Sezgin](https://www.linkedin.com/in/mattsezgin/).

# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver.

## [1.0.0] - unreleased

Initial public release.

### Added
- `clay-v2.js`: 50 commands - tables, fields, views, records, people/company
  sources, webhook sources, enrichment runs, and a declarative spec workflow
  (export / validate / diff / apply)
- `clay-api.js`: lightweight 35-command client + require-able `ClayAPI` class
  with automatic session refresh
- `full_export.py`: full-fidelity workbook exporter (all rows, including AI and
  action column payloads)
- Playbook operator lifecycle: intake -> plan -> prepare -> preflight -> sample
  -> evidence -> quality report -> parity -> scale gate -> completion audit
- Integration library: 40 Clay actions with observed input bindings, statuses,
  and battle-test verdicts
- Community templates with contributor profiles, per-template voting threads,
  and an auto-generated front-page leaderboard
- Guided share wizard (`npm run share`) that rebuilds workflows as clean
  templates - never copies raw column config
- Safety tooling: repo-wide secret/ID scanner, community schema validator,
  CI safety gate (scanner + gitleaks + schema + offline test battery)
- 10 Claude Code skills covering onboarding through security practices
- Environment-driven write scopes: `CLAY_WORKSPACE_ID`, `CLAY_FOLDER_ID`,
  `CLAY_WRITE_SCOPES` - the tool ships with no default workspace

### Security
- Write scopes, `--confirm` gates, 10-row sample caps, and dry-run-first
  conventions on every mutating path
- The shape of real Clay resource IDs is banned repo-wide in CI

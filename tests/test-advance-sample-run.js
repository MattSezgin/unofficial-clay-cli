#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runDir = path.join(root, 'runs', 'test-template-plan', 'advanced-sample');
fs.mkdirSync(runDir, { recursive: true });

function runJson(script, args, env = {}) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(root, script),
    ...args,
    '--json',
  ], { encoding: 'utf8', env }));
}

const prepared = runJson('lib/prepare-sample-run.js', [
  '--request',
  'Build a campaign personalization table for cold email with opener angles, persona, company domain, and QA fields.',
  '--inputs',
  path.join(root, 'examples', 'outbound-personalization-input.example.yaml'),
  '--config',
  path.join(root, 'config.example.yaml'),
  '--profile',
  'yourTestProfile',
  '--workspace',
  'TEST_WS',
  '--folder',
  'f_TEST_FOLDER',
  '--workbook',
  'wb_TEST_WORKBOOK',
  '--out-dir',
  path.join(runDir, 'prepared'),
]);

const preparedPath = path.join(root, prepared.artifacts.manifest);
const applyPath = path.join(runDir, 'apply-result.json');
fs.writeFileSync(applyPath, JSON.stringify({
  applied: true,
  tableId: 't_TEST_SAMPLE_TABLE',
  viewId: 'gv_TEST_SAMPLE_VIEW',
  operations: [
    { op: 'create_table', id: 't_TEST_SAMPLE_TABLE' },
    { op: 'create_view', id: 'gv_TEST_SAMPLE_VIEW' },
  ],
  provenance: {
    kind: 'clay-command',
    capturedAt: '2026-06-09T00:00:00.000Z',
    commandId: 'apply_sample_spec',
    exactCommand: 'node clay-v2.js apply-spec specs/templates/outbound-personalization.yaml --workspace TEST_WS --folder f_TEST_FOLDER --workbook wb_TEST_WORKBOOK --confirm',
    exitCode: 0,
    toolVersion: 'test-fixture',
    workspaceId: 'TEST_WS',
    folderId: 'f_TEST_FOLDER',
    workbookId: 'wb_TEST_WORKBOOK',
    tableId: 't_TEST_SAMPLE_TABLE',
    viewId: 'gv_TEST_SAMPLE_VIEW',
  },
}, null, 2));

const verifyPath = path.join(runDir, 'verify.json');
fs.writeFileSync(verifyPath, JSON.stringify({ valid: true, issueCount: 0, issues: [] }, null, 2));

const manifestPath = path.join(runDir, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify({
  table: { id: 't_TEST_SAMPLE_TABLE' },
  records: [
    { id: 'r_TEST_1' },
    { id: 'r_TEST_2' },
  ],
}, null, 2));

const advanced = runJson('lib/advance-sample-run.js', [
  '--prepared',
  preparedPath,
  '--apply-result',
  applyPath,
  '--config',
  path.join(root, 'config.example.yaml'),
  '--profile',
  'yourTestProfile',
  '--workspace',
  'TEST_WS',
  '--folder',
  'f_TEST_FOLDER',
  '--workbook',
  'wb_TEST_WORKBOOK',
  '--verify',
  verifyPath,
  '--manifest',
  manifestPath,
  '--counts',
  'rowsTested=2,successCount=2,errorCount=0,readyCount=2',
  '--quality-reviewed',
  'true',
  '--out-dir',
  path.join(runDir, 'advanced'),
]);

assert.strictEqual(advanced.mode, 'offline-advanced-sample-run');
assert.strictEqual(advanced.readiness.status, 'ready_for_next_live_command_confirmation');
assert.strictEqual(advanced.readiness.nextLiveCommandId, 'run_action_sample_1');
assert(advanced.readiness.nextLiveCommand.includes('t_TEST_SAMPLE_TABLE'));
assert(advanced.readiness.nextLiveCommand.includes('gv_TEST_SAMPLE_VIEW'));
assert.strictEqual(advanced.readiness.firstRunGatePassed, true);
assert.strictEqual(advanced.readiness.recommendation, 'continue');
assert.deepStrictEqual(advanced.issues, []);
for (const key of ['hydratedSampleRunPacket', 'hydratedPreflight', 'evidence', 'qualityReport', 'manifest']) {
  assert(advanced.artifacts[key], `missing artifact: ${key}`);
  assert(fs.existsSync(path.join(root, advanced.artifacts[key])), `missing artifact file: ${key}`);
}

const hydrated = JSON.parse(fs.readFileSync(path.join(root, advanced.artifacts.hydratedSampleRunPacket), 'utf8'));
assert.strictEqual(hydrated.completedLiveCommands[0].id, 'apply_sample_spec');
assert(hydrated.liveCommands.every(command => !command.command.includes('<sample-table>')));
assert(hydrated.liveCommands.every(command => !command.command.includes('<sample-view>')));

const report = fs.readFileSync(path.join(root, advanced.artifacts.qualityReport), 'utf8');
assert(report.includes('Rows tested: 2'));
assert(report.includes('Recommendation: continue'));

const evidence = JSON.parse(fs.readFileSync(path.join(root, advanced.artifacts.evidence), 'utf8'));
assert.strictEqual(evidence.provenance.kind, 'clay-evidence-bundle');
assert.match(evidence.provenance.sourceArtifactSha256, /^[a-f0-9]{64}$/);
const sourceCommandIds = new Set(evidence.provenance.sourceCommands.map(command => command.commandId));
assert(sourceCommandIds.has('apply_sample_spec'));
assert(sourceCommandIds.has('run_action_sample_1'));

// Pin CLAY_WORKSPACE_ID via env so the mismatched --workspace flag below trips
// preflight's pinned_workspace drift check (env pin always wins over an
// unpinned flag value once a pin exists).
const notReady = runJson('lib/advance-sample-run.js', [
  '--prepared',
  preparedPath,
  '--apply-result',
  applyPath,
  '--workspace',
  '999999',
  '--folder',
  'f_TEST_FOLDER',
  '--workbook',
  'wb_TEST_WORKBOOK',
  '--out-dir',
  path.join(runDir, 'not-ready'),
], { CLAY_WORKSPACE_ID: 'TEST_WS' });
assert.strictEqual(notReady.readiness.status, 'not_ready');
assert(notReady.issues.some(issue => issue.type === 'next_live_command_not_ready'));

console.log(JSON.stringify({ ok: true, checked: 'advanced-sample-run' }, null, 2));

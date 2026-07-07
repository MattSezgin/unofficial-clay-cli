#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runDir = path.join(root, 'runs', 'test-template-plan');
const packetPath = path.join(runDir, 'evidence-sample-run-packet.json');
const applyResultPath = path.join(runDir, 'evidence-apply-result.json');
const hydratedPath = path.join(runDir, 'evidence-hydrated.json');
const preflightPath = path.join(runDir, 'evidence-preflight.json');
const hydratedPreflightPath = path.join(runDir, 'evidence-hydrated-preflight.json');
const verifyPath = path.join(runDir, 'evidence-verify.json');
const manifestPath = path.join(runDir, 'evidence-manifest.json');
const evidencePath = path.join(runDir, 'evidence-collected.json');
const planPath = path.join(runDir, 'evidence-plan.json');
const reportPath = path.join(runDir, 'evidence-report.md');

fs.mkdirSync(runDir, { recursive: true });

execFileSync(process.execPath, [
  path.join(root, 'lib', 'plan-playbook.js'),
  path.join(root, 'playbooks', 'outbound-personalization.yaml'),
  '--inputs',
  path.join(root, 'examples', 'outbound-personalization-input.example.yaml'),
  '--spec',
  'specs/templates/outbound-personalization.yaml',
  '--out',
  planPath,
], { encoding: 'utf8' });

execFileSync(process.execPath, [
  path.join(root, 'lib', 'plan-playbook.js'),
  path.join(root, 'playbooks', 'outbound-personalization.yaml'),
  '--inputs',
  path.join(root, 'examples', 'outbound-personalization-input.example.yaml'),
  '--sample-run',
  'outbound-personalization.yaml',
  '--out',
  packetPath,
], { encoding: 'utf8' });

execFileSync(process.execPath, [
  path.join(root, 'lib', 'preflight-sample-run.js'),
  packetPath,
  '--workspace',
  'TEST_WS',
  '--folder',
  'f_TEST_FOLDER',
  '--workbook',
  'wb_TEST_WORKBOOK',
  '--out',
  preflightPath,
], { encoding: 'utf8' });

fs.writeFileSync(applyResultPath, JSON.stringify({
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
}, null, 2) + '\n');

execFileSync(process.execPath, [
  path.join(root, 'lib', 'hydrate-sample-run.js'),
  packetPath,
  '--apply-result',
  applyResultPath,
  '--out',
  hydratedPath,
], { encoding: 'utf8' });

execFileSync(process.execPath, [
  path.join(root, 'lib', 'preflight-sample-run.js'),
  hydratedPath,
  '--workspace',
  'TEST_WS',
  '--folder',
  'f_TEST_FOLDER',
  '--workbook',
  'wb_TEST_WORKBOOK',
  '--out',
  hydratedPreflightPath,
], { encoding: 'utf8' });

fs.writeFileSync(verifyPath, JSON.stringify({ valid: true, issueCount: 0, issues: [] }, null, 2) + '\n');
fs.writeFileSync(manifestPath, JSON.stringify({
  table: { id: 't_TEST_SAMPLE_TABLE', name: 'fake sample table' },
  records: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
}, null, 2) + '\n');

const collectOutput = execFileSync(process.execPath, [
  path.join(root, 'lib', 'collect-evidence.js'),
  '--apply',
  applyResultPath,
  '--preflight',
  preflightPath,
  '--hydrated-preflight',
  hydratedPreflightPath,
  '--verify',
  verifyPath,
  '--manifest',
  manifestPath,
  '--counts',
  'successCount=3,readyCount=2,manualReviewCount=1',
  '--out',
  evidencePath,
], { encoding: 'utf8' });
assert(JSON.parse(collectOutput).wrote.endsWith('evidence-collected.json'));

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
assert.strictEqual(evidence.tableId, 't_TEST_SAMPLE_TABLE');
assert.strictEqual(evidence.viewId, 'gv_TEST_SAMPLE_VIEW');
assert.strictEqual(evidence.counts.rowsTested, 3);
assert.strictEqual(evidence.counts.errorCount, 0);
assert.strictEqual(evidence.firstRunGatePassed, true);
assert.strictEqual(evidence.recommendation, 'continue');
assert(evidence.preflight.liveCommands.some(command => command.id === 'apply_sample_spec'));
assert(evidence.hydratedPreflight.liveCommands.some(command => command.id === 'run_action_sample_1'));
assert.strictEqual(evidence.provenance.kind, 'clay-evidence-bundle');
assert.match(evidence.provenance.sourceArtifactSha256, /^[a-f0-9]{64}$/);
const sourceCommandIds = new Set(evidence.provenance.sourceCommands.map(command => command.commandId));
assert(sourceCommandIds.has('apply_sample_spec'));
assert(sourceCommandIds.has('run_action_sample_1'));

execFileSync(process.execPath, [
  path.join(root, 'lib', 'quality-report.js'),
  planPath,
  '--evidence',
  evidencePath,
  '--out',
  reportPath,
], { encoding: 'utf8' });
const report = fs.readFileSync(reportPath, 'utf8');
assert(report.includes('Rows tested: 3'));
assert(report.includes('Table ID: t_TEST_SAMPLE_TABLE'));
assert(report.includes('Recommendation: continue'));
assert(report.includes('run_action_sample_1: node clay-v2.js run-top t_TEST_SAMPLE_TABLE'));

console.log(JSON.stringify({ ok: true, checked: 'evidence-collection' }, null, 2));

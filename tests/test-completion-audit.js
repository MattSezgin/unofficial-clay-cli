#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function runJson(args) {
  return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', env: {} }));
}

function byId(audit, id) {
  const found = audit.requirements.find(item => item.id === id);
  assert(found, `missing requirement ${id}`);
  return found;
}

const emptyAudit = runJson([
  path.join(root, 'lib', 'completion-audit.js'),
  '--json',
]);

assert.strictEqual(emptyAudit.mode, 'offline-completion-audit');
assert.strictEqual(emptyAudit.overallStatus, 'not_complete');
assert.strictEqual(byId(emptyAudit, 'plain_language_intake').status, 'passed');
assert.strictEqual(byId(emptyAudit, 'playbook_selection').status, 'passed');
assert.strictEqual(byId(emptyAudit, 'public_repo_checklist').status, 'passed');
assert.strictEqual(byId(emptyAudit, 'live_sample_build').status, 'missing');
assert.strictEqual(byId(emptyAudit, 'workbook_parity').status, 'missing');
assert.strictEqual(byId(emptyAudit, 'first_10_action_rows').status, 'missing');
assert(emptyAudit.hardRules.some(rule => rule.includes('never executes Clay commands')));

const outDir = path.join(root, 'runs', 'test-template-plan', 'completion-audit-simulation');
const simulation = runJson([
  path.join(root, 'lib', 'simulate-full-loop.js'),
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
  'wb_SIMULATED_WORKBOOK',
  '--out-dir',
  outDir,
  '--json',
]);

const simulatedAudit = runJson([
  path.join(root, 'lib', 'completion-audit.js'),
  '--prepared',
  path.join(root, simulation.artifacts.prepared),
  '--advanced',
  path.join(root, simulation.artifacts.advanced),
  '--evidence',
  path.join(root, simulation.artifacts.evidence),
  '--quality-report',
  path.join(root, simulation.artifacts.qualityReport),
  '--scale-gate',
  path.join(root, simulation.artifacts.scaleGate),
  '--simulation',
  path.join(root, simulation.artifacts.simulation),
  '--json',
]);

assert.strictEqual(simulatedAudit.overallStatus, 'not_complete');
assert.strictEqual(simulatedAudit.artifactClassification.prepared, 'simulated_only');
assert.strictEqual(simulatedAudit.artifactClassification.applyResult, 'missing');
assert.strictEqual(simulatedAudit.artifactClassification.evidence, 'simulated_only');
assert.strictEqual(simulatedAudit.artifactClassification.scaleGate, 'simulated_only');
assert.strictEqual(byId(simulatedAudit, 'live_sample_build').status, 'simulated_only');
assert.strictEqual(byId(simulatedAudit, 'first_10_action_rows').status, 'simulated_only');
assert.strictEqual(byId(simulatedAudit, 'readback_quality_report').status, 'simulated_only');
assert.strictEqual(byId(simulatedAudit, 'scale_gate_second_confirmation').status, 'simulated_only');
assert(simulatedAudit.nextActions.some(action => action.includes('Simulated')));

const auditFixtureDir = path.join(root, 'runs', 'test-template-plan', 'completion-audit-live-fixtures');
fs.mkdirSync(auditFixtureDir, { recursive: true });
const readyPreparedPath = path.join(auditFixtureDir, 'ready-prepared.json');
const applyResultPath = path.join(auditFixtureDir, 'apply-result.json');
const applyResultWithProvenancePath = path.join(auditFixtureDir, 'apply-result-with-provenance.json');
const sourceImportWithProvenancePath = path.join(auditFixtureDir, 'source-import-with-provenance.json');
fs.writeFileSync(readyPreparedPath, JSON.stringify({
  artifactVersion: 1,
  mode: 'offline-prepared-sample-run',
  readiness: {
    status: 'ready_for_first_live_command_confirmation',
    readyForFirstLiveCommand: true,
  },
}, null, 2) + '\n');
fs.writeFileSync(applyResultPath, JSON.stringify({
  applied: true,
  tableId: 't_LIVE_LIKE_SAMPLE_TABLE',
  viewId: 'gv_LIVE_LIKE_SAMPLE_VIEW',
}, null, 2) + '\n');
fs.writeFileSync(applyResultWithProvenancePath, JSON.stringify({
  applied: true,
  tableId: 't_LIVE_LIKE_SAMPLE_TABLE',
  viewId: 'gv_LIVE_LIKE_SAMPLE_VIEW',
  provenance: {
    kind: 'clay-command',
    capturedAt: '2026-06-09T00:00:00.000Z',
    commandId: 'apply_sample_spec',
    exactCommand: 'node clay-v2.js apply-spec specs/templates/outbound-personalization.yaml --workspace "TEST_WS" --workbook "wb_TEST" --confirm',
    exitCode: 0,
    toolVersion: 'test-fixture',
  },
}, null, 2) + '\n');
fs.writeFileSync(sourceImportWithProvenancePath, JSON.stringify({
  imported: true,
  destinationTableId: 't_LIVE_LIKE_PEOPLE_TABLE',
  result: {
    tableId: 't_LIVE_LIKE_PEOPLE_TABLE',
    viewId: 'gv_LIVE_LIKE_PEOPLE_VIEW',
    sourceId: 's_LIVE_LIKE_PEOPLE_SOURCE',
  },
  provenance: {
    kind: 'clay-command',
    capturedAt: '2026-06-09T00:00:00.000Z',
    commandId: 'source_import',
    exactCommand: 'node clay-v2.js source-import specs/templates/people-from-companies-people-source.yaml --workspace "TEST_WS" --destination-table t_LIVE_LIKE_PEOPLE_TABLE --confirm',
    exitCode: 0,
    toolVersion: 'test-fixture',
  },
}, null, 2) + '\n');

const preparedOnlyAudit = runJson([
  path.join(root, 'lib', 'completion-audit.js'),
  '--prepared',
  readyPreparedPath,
  '--json',
]);
assert.strictEqual(preparedOnlyAudit.overallStatus, 'not_complete');
assert.strictEqual(byId(preparedOnlyAudit, 'live_sample_build').status, 'incomplete');
assert(byId(preparedOnlyAudit, 'live_sample_build').blockingReason.includes('apply/import result'));

const applyResultAudit = runJson([
  path.join(root, 'lib', 'completion-audit.js'),
  '--prepared',
  readyPreparedPath,
  '--apply-result',
  applyResultPath,
  '--json',
]);
assert.strictEqual(applyResultAudit.overallStatus, 'not_complete');
assert.strictEqual(applyResultAudit.artifactClassification.applyResult, 'present');
assert.strictEqual(byId(applyResultAudit, 'live_sample_build').status, 'incomplete');
assert(byId(applyResultAudit, 'live_sample_build').blockingReason.includes('provenance'));

const provenancedApplyResultAudit = runJson([
  path.join(root, 'lib', 'completion-audit.js'),
  '--prepared',
  readyPreparedPath,
  '--apply-result',
  applyResultWithProvenancePath,
  '--json',
]);
assert.strictEqual(provenancedApplyResultAudit.overallStatus, 'not_complete');
assert.strictEqual(provenancedApplyResultAudit.artifactClassification.applyResult, 'present');
assert.strictEqual(byId(provenancedApplyResultAudit, 'live_sample_build').status, 'passed');
assert(byId(provenancedApplyResultAudit, 'live_sample_build').evidence.includes('apply/import result has clay-command provenance'));
assert.strictEqual(byId(applyResultAudit, 'first_10_action_rows').status, 'missing');

const provenancedSourceImportAudit = runJson([
  path.join(root, 'lib', 'completion-audit.js'),
  '--prepared',
  readyPreparedPath,
  '--apply-result',
  sourceImportWithProvenancePath,
  '--json',
]);
assert.strictEqual(provenancedSourceImportAudit.overallStatus, 'not_complete');
assert.strictEqual(provenancedSourceImportAudit.artifactClassification.applyResult, 'present');
assert.strictEqual(byId(provenancedSourceImportAudit, 'live_sample_build').status, 'passed');
assert(byId(provenancedSourceImportAudit, 'live_sample_build').evidence.includes('apply/import result includes table/view IDs'));

const verifyPath = path.join(auditFixtureDir, 'verify-result.json');
const manifestPath = path.join(auditFixtureDir, 'redacted-manifest.json');
const evidencePath = path.join(auditFixtureDir, 'tool-produced-evidence.json');
const scaleGatePath = path.join(auditFixtureDir, 'tool-produced-scale-gate.json');
const qualityReportPath = path.join(auditFixtureDir, 'tool-produced-quality-report.md');
const workbookParityPath = path.join(auditFixtureDir, 'tool-produced-workbook-parity.json');
fs.writeFileSync(verifyPath, JSON.stringify({ valid: true, issueCount: 0, issues: [] }, null, 2) + '\n');
fs.writeFileSync(manifestPath, JSON.stringify({
  table: { id: 't_LIVE_LIKE_SAMPLE_TABLE' },
  records: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
}, null, 2) + '\n');
execFileSync(process.execPath, [
  path.join(root, 'lib', 'collect-evidence.js'),
  '--apply',
  applyResultWithProvenancePath,
  '--verify',
  verifyPath,
  '--manifest',
  manifestPath,
  '--counts',
  'successCount=3,readyCount=3,manualReviewCount=0',
  '--quality-reviewed',
  'true',
  '--out',
  evidencePath,
], { encoding: 'utf8', env: {} });
fs.writeFileSync(qualityReportPath, '# Clay Sample Quality Report\n\nEvidence provenance kind: clay-evidence-bundle\nRecommendation: continue\n');
fs.writeFileSync(workbookParityPath, JSON.stringify({
  artifactVersion: 1,
  kind: 'clay-workbook-parity-audit',
  status: 'workbook_parity_complete',
  workbookId: 'wb_LIVE_LIKE_WORKBOOK',
  workspaceId: 'TEST_WS',
  summary: {
    tableCount: 1,
    actionCount: 3,
    formulaCount: 2,
    viewCount: 3,
    promptedActionCount: 1,
    jsonSchemaActionCount: 3,
    runConditionActionCount: 3,
    providerActionCount: 1,
    httpActionCount: 1,
  },
  checks: [{ id: 'has_actions', passed: true, evidence: '3 action field(s)' }],
  missing: [],
}, null, 2) + '\n');
execFileSync(process.execPath, [
  path.join(root, 'lib', 'scale-gate.js'),
  '--evidence',
  evidencePath,
  '--workbook-parity',
  workbookParityPath,
  '--command',
  'node clay-v2.js run-top t_LIVE_LIKE_SAMPLE_TABLE --view gv_LIVE_LIKE_SAMPLE_VIEW --n 100 --confirm',
  '--quality-reviewed',
  'true',
  '--second-confirmed',
  'true',
  '--allow-confirmed-scale',
  'true',
  '--out',
  scaleGatePath,
], { encoding: 'utf8', env: {} });

const liveProvenanceAudit = runJson([
  path.join(root, 'lib', 'completion-audit.js'),
  '--prepared',
  readyPreparedPath,
  '--apply-result',
  applyResultWithProvenancePath,
  '--evidence',
  evidencePath,
  '--quality-report',
  qualityReportPath,
  '--scale-gate',
  scaleGatePath,
  '--workbook-parity',
  workbookParityPath,
  '--json',
]);
assert.strictEqual(liveProvenanceAudit.overallStatus, 'complete');
assert.strictEqual(byId(liveProvenanceAudit, 'workbook_parity').status, 'passed');
assert.strictEqual(byId(liveProvenanceAudit, 'first_10_action_rows').status, 'passed');
assert.strictEqual(byId(liveProvenanceAudit, 'readback_quality_report').status, 'passed');
assert.strictEqual(byId(liveProvenanceAudit, 'continue_stop_recommendation').status, 'passed');
assert.strictEqual(byId(liveProvenanceAudit, 'scale_gate_second_confirmation').status, 'passed');

const devModeScaleGatePath = path.join(auditFixtureDir, 'tool-produced-dev-mode-scale-gate.json');
execFileSync(process.execPath, [
  path.join(root, 'lib', 'scale-gate.js'),
  '--evidence',
  evidencePath,
  '--workbook-parity',
  workbookParityPath,
  '--command',
  'node clay-v2.js run-top t_LIVE_LIKE_SAMPLE_TABLE --view gv_LIVE_LIKE_SAMPLE_VIEW --n 100 --dev-mode',
  '--quality-reviewed',
  'true',
  '--out',
  devModeScaleGatePath,
], { encoding: 'utf8', env: {} });
const devModeAudit = runJson([
  path.join(root, 'lib', 'completion-audit.js'),
  '--prepared',
  readyPreparedPath,
  '--apply-result',
  applyResultWithProvenancePath,
  '--evidence',
  evidencePath,
  '--quality-report',
  qualityReportPath,
  '--scale-gate',
  devModeScaleGatePath,
  '--workbook-parity',
  workbookParityPath,
  '--json',
]);
assert.strictEqual(devModeAudit.overallStatus, 'complete');
assert.strictEqual(byId(devModeAudit, 'scale_gate_second_confirmation').status, 'passed');
assert(byId(devModeAudit, 'scale_gate_second_confirmation').evidence.includes('dev-mode scale gate recorded'));

const manualEvidencePath = path.join(auditFixtureDir, 'manual-evidence.json');
fs.writeFileSync(manualEvidencePath, JSON.stringify({
  tableId: 't_LIVE_LIKE_SAMPLE_TABLE',
  viewId: 'gv_LIVE_LIKE_SAMPLE_VIEW',
  counts: { rowsTested: 3, errorCount: 0 },
  firstRunGatePassed: true,
  recommendation: 'continue',
  provenance: {
    kind: 'clay-evidence-bundle',
    capturedAt: '2026-06-09T00:00:00.000Z',
    sourceArtifactSha256: 'not-a-tool-hash',
    sourceCommands: [{ commandId: 'manual', exactCommand: 'node clay-v2.js run-top t --n 10 --confirm' }],
  },
}, null, 2) + '\n');
const manualAudit = runJson([
  path.join(root, 'lib', 'completion-audit.js'),
  '--prepared',
  readyPreparedPath,
  '--apply-result',
  applyResultWithProvenancePath,
  '--evidence',
  manualEvidencePath,
  '--quality-report',
  qualityReportPath,
  '--json',
]);
assert.strictEqual(byId(manualAudit, 'first_10_action_rows').status, 'missing');
assert.strictEqual(byId(manualAudit, 'continue_stop_recommendation').status, 'missing');

console.log(JSON.stringify({ ok: true, checked: 'completion-audit' }, null, 2));

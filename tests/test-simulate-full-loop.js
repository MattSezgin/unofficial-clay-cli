#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'runs', 'test-template-plan', 'full-loop-simulation');
fs.mkdirSync(outDir, { recursive: true });

const simulation = JSON.parse(execFileSync(process.execPath, [
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
], { encoding: 'utf8', env: {} }));

assert.strictEqual(simulation.mode, 'offline-full-loop-simulation');
assert.strictEqual(simulation.simulated, true);
assert(simulation.warning.includes('fake evidence'));
assert.strictEqual(simulation.selectedPlaybook.id, 'outbound-personalization');
assert.strictEqual(simulation.readiness.prepared, 'ready_for_first_live_command_confirmation');
assert.strictEqual(simulation.readiness.advanced, 'ready_for_next_live_command_confirmation');
assert.strictEqual(simulation.readiness.scaleGate, 'ready_for_second_scale_confirmation');
assert.strictEqual(simulation.readiness.fullOfflineLoopReady, true);

for (const key of ['prepared', 'simulatedApplyResult', 'simulatedVerify', 'simulatedManifest', 'advanced', 'evidence', 'qualityReport', 'workbookParity', 'scaleGate', 'simulation']) {
  assert(simulation.artifacts[key], `missing artifact: ${key}`);
  assert(fs.existsSync(path.join(root, simulation.artifacts[key])), `missing artifact file: ${key}`);
}

const scaleGate = JSON.parse(fs.readFileSync(path.join(root, simulation.artifacts.scaleGate), 'utf8'));
assert.strictEqual(scaleGate.readiness.readyForScaleConfirmation, true);
assert.strictEqual(scaleGate.readiness.workbookParityStatus, 'workbook_parity_complete');
assert.strictEqual(scaleGate.readiness.workbookParityOk, true);
assert(scaleGate.confirmationPrompt.includes('Confirm this exact Clay scale command'));
assert.strictEqual(scaleGate.readiness.secondConfirmationReceived, false);

const workbookParity = JSON.parse(fs.readFileSync(path.join(root, simulation.artifacts.workbookParity), 'utf8'));
assert.strictEqual(workbookParity.status, 'workbook_parity_complete');
assert.strictEqual(workbookParity.simulated, true);

const report = fs.readFileSync(path.join(root, simulation.artifacts.qualityReport), 'utf8');
assert(report.includes('Rows tested: 10'));
assert(report.includes('Recommendation: continue'));
assert(!report.includes('Example Co'), 'simulation report should not include row values');

assert(simulation.nextLiveSequence.length >= 7);
assert(!JSON.stringify(simulation).includes('s%3A'), 'simulation must not include Clay session material');

console.log(JSON.stringify({ ok: true, checked: 'full-loop-simulation' }, null, 2));

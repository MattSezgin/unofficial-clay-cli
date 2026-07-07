#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runDir = path.join(root, 'runs', 'test-template-plan');
const packetPath = path.join(runDir, 'hydrate-sample-run-packet.json');
const applyResultPath = path.join(runDir, 'hydrate-apply-result.json');
const hydratedPath = path.join(runDir, 'hydrate-sample-run-hydrated.json');
const preflightPath = path.join(runDir, 'hydrate-preflight.json');

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

fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(applyResultPath, JSON.stringify({
  applied: true,
  tableId: 't_TEST_SAMPLE_TABLE',
  viewId: 'gv_TEST_SAMPLE_VIEW',
  operations: [
    { op: 'create_table', id: 't_TEST_SAMPLE_TABLE' },
    { op: 'create_view', id: 'gv_TEST_SAMPLE_VIEW' },
  ],
}, null, 2) + '\n');

const hydrateOutput = execFileSync(process.execPath, [
  path.join(root, 'lib', 'hydrate-sample-run.js'),
  packetPath,
  '--apply-result',
  applyResultPath,
  '--out',
  hydratedPath,
], { encoding: 'utf8' });
assert(JSON.parse(hydrateOutput).wrote.endsWith('hydrate-sample-run-hydrated.json'));

const hydrated = JSON.parse(fs.readFileSync(hydratedPath, 'utf8'));
assert.strictEqual(hydrated.mode, 'offline-sample-run-packet');
assert.strictEqual(hydrated.hydration.tableId, 't_TEST_SAMPLE_TABLE');
assert.strictEqual(hydrated.hydration.viewId, 'gv_TEST_SAMPLE_VIEW');
assert(hydrated.completedLiveCommands.some(command => command.id === 'apply_sample_spec'));
assert(!hydrated.liveCommands.some(command => command.id === 'apply_sample_spec'));
assert(hydrated.liveCommands.some(command => command.id === 'run_action_sample_1'));
assert(hydrated.liveCommands.find(command => command.id === 'run_action_sample_1').command.includes('t_TEST_SAMPLE_TABLE'));
assert(hydrated.liveCommands.find(command => command.id === 'run_action_sample_1').command.includes('gv_TEST_SAMPLE_VIEW'));
assert(hydrated.readbackCommands.every(command => !command.command.includes('<sample-')));
assert(hydrated.confirmationPrompts.every(prompt => !prompt.prompt.includes('<sample-')));

const preflightOutput = execFileSync(process.execPath, [
  path.join(root, 'lib', 'preflight-sample-run.js'),
  hydratedPath,
  '--workspace',
  'TEST_WS',
  '--folder',
  'f_TEST_FOLDER',
  '--workbook',
  'wb_TEST_WORKBOOK',
  '--out',
  preflightPath,
], { encoding: 'utf8' });
assert(JSON.parse(preflightOutput).wrote.endsWith('hydrate-preflight.json'));

const preflight = JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
assert.strictEqual(preflight.readiness.readyForFirstLiveCommand, true);
assert.strictEqual(preflight.readiness.readyForAllLiveCommands, true);
assert.strictEqual(preflight.readiness.firstLiveCommandId, 'run_action_sample_1');
assert.deepStrictEqual(preflight.readiness.unresolvedCommands, []);
assert(preflight.liveCommands.every(command => command.confirmationRequired));
assert(preflight.liveCommands.find(command => command.id === 'run_action_sample_1').command.includes('t_TEST_SAMPLE_TABLE'));

console.log(JSON.stringify({ ok: true, checked: 'sample-run-hydration' }, null, 2));


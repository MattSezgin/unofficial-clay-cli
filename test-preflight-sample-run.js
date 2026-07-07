#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const packetPath = path.join(root, 'runs', 'test-template-plan', 'preflight-sample-run-packet.json');
const sourcePacketPath = path.join(root, 'runs', 'test-template-plan', 'preflight-source-sample-run-packet.json');
const missingPreflightPath = path.join(root, 'runs', 'test-template-plan', 'preflight-missing.json');
const readyPreflightPath = path.join(root, 'runs', 'test-template-plan', 'preflight-ready.json');
const sourceReadyPreflightPath = path.join(root, 'runs', 'test-template-plan', 'preflight-source-ready.json');

execFileSync(process.execPath, [
  path.join(root, 'plan-playbook.js'),
  path.join(root, 'playbooks', 'outbound-personalization.yaml'),
  '--inputs',
  path.join(root, 'examples', 'outbound-personalization-input.example.yaml'),
  '--sample-run',
  'outbound-personalization.yaml',
  '--out',
  packetPath,
], { encoding: 'utf8' });

const missingOutput = execFileSync(process.execPath, [
  path.join(root, 'preflight-sample-run.js'),
  packetPath,
  '--out',
  missingPreflightPath,
], { encoding: 'utf8', env: {} });
assert(JSON.parse(missingOutput).wrote.endsWith('preflight-missing.json'));
const missing = JSON.parse(fs.readFileSync(missingPreflightPath, 'utf8'));
assert.strictEqual(missing.mode, 'offline-sample-run-preflight');
assert.strictEqual(missing.readiness.readyForConfirmation, false);
assert(missing.readiness.missingRuntime.includes('CLAY_WORKSPACE_ID'));
assert(missing.readiness.missingRuntime.includes('CLAY_TEST_FOLDER_ID'));
assert(missing.readiness.missingRuntime.includes('CLAY_WORKBOOK_ID'));
assert(missing.liveCommands.some(command => command.unresolved.includes('CLAY_WORKSPACE_ID')));
assert(missing.liveCommands.some(command => command.unresolved.includes('CLAY_TEST_FOLDER_ID')));

const readyOutput = execFileSync(process.execPath, [
  path.join(root, 'preflight-sample-run.js'),
  packetPath,
  '--workspace',
  'TEST_WS',
  '--folder',
  'f_TEST_FOLDER',
  '--workbook',
  'wb_TEST_WORKBOOK',
  '--out',
  readyPreflightPath,
], { encoding: 'utf8', env: {} });
assert(JSON.parse(readyOutput).wrote.endsWith('preflight-ready.json'));
const ready = JSON.parse(fs.readFileSync(readyPreflightPath, 'utf8'));
assert.strictEqual(ready.readiness.readyForConfirmation, false);
assert.strictEqual(ready.readiness.readyForFirstLiveCommand, true);
assert.strictEqual(ready.readiness.readyForAllLiveCommands, false);
assert.strictEqual(ready.readiness.firstLiveCommandId, 'apply_sample_spec');
assert.strictEqual(ready.readiness.workspaceCheck.passed, true);
assert.deepStrictEqual(ready.readiness.missingRuntime, []);
assert(ready.readiness.unresolvedCommands.includes('run_action_sample_1'));
assert(ready.liveCommands.every(command => command.confirmationRequired));
assert(ready.liveCommands.some(command => command.command.includes('--workspace "TEST_WS"')));
assert(ready.liveCommands.some(command => command.command.includes('--folder "f_TEST_FOLDER"')));
assert(ready.liveCommands.some(command => command.command.includes('--workbook "wb_TEST_WORKBOOK"')));
assert(ready.liveCommands.every(command => command.prompt.includes('Confirm this exact Clay command')));
assert(ready.liveCommands.find(command => command.id === 'run_action_sample_1').unresolved.includes('sample-table'));
assert(ready.liveCommands.find(command => command.id === 'run_action_sample_1').unresolved.includes('sample-view'));
assert(!JSON.stringify(ready).includes('Example Co'), 'preflight should not include row values');

execFileSync(process.execPath, [
  path.join(root, 'plan-playbook.js'),
  path.join(root, 'playbooks', 'people-from-companies.yaml'),
  '--inputs',
  path.join(root, 'examples', 'people-from-companies-input.example.yaml'),
  '--sample-run',
  'people-from-companies-company-source.yaml',
  '--out',
  sourcePacketPath,
], { encoding: 'utf8' });

const sourceReadyOutput = execFileSync(process.execPath, [
  path.join(root, 'preflight-sample-run.js'),
  sourcePacketPath,
  '--config',
  path.join(root, 'config.example.yaml'),
  '--profile',
  'yourTestProfile',
  '--workspace',
  'TEST_WS',
  '--folder',
  'f_TEST_FOLDER',
  '--out',
  sourceReadyPreflightPath,
], { encoding: 'utf8', env: {} });
assert(JSON.parse(sourceReadyOutput).wrote.endsWith('preflight-source-ready.json'));
const sourceReady = JSON.parse(fs.readFileSync(sourceReadyPreflightPath, 'utf8'));
assert.strictEqual(sourceReady.readiness.firstLiveCommandId, 'preview_source_sample');
assert.strictEqual(sourceReady.readiness.readyForFirstLiveCommand, true);
assert.strictEqual(sourceReady.readiness.profileCheck.valid, true);
assert.deepStrictEqual(sourceReady.readiness.missingRuntime, []);
assert(sourceReady.readiness.unresolvedCommands.includes('import_source_sample'));
assert.strictEqual(sourceReady.liveCommands.filter(command => command.readyForConfirmation).length, 1);
assert.strictEqual(
  sourceReady.operatorPacket.firstLiveCommand.command,
  'node clay-v2.js source-preview specs/templates/people-from-companies-company-source.yaml --workspace "TEST_WS" --confirm'
);
assert(sourceReady.operatorPacket.commandBoundary.includes('Do not batch source-import'));
assert(sourceReady.operatorPacket.commandBoundary.includes('dependent people-source preview/import'));
assert(sourceReady.operatorPacket.expectedEvidence.some(item => item.includes('commandProvenance.commandId = "source_preview"')));
assert(sourceReady.operatorPacket.redactionExpectations.some(item => item.includes('ignored runs/')));
assert(sourceReady.operatorPacket.readbackInspectionSteps.some(item => item.includes('your configured workspace')));
assert(sourceReady.operatorPacket.stopConditionsBeforeImportOrTableCreation.some(item => item.includes('dependent people-source preview/import')));
assert(sourceReady.liveCommands.find(command => command.id === 'preview_source_sample').command.includes('--workspace "TEST_WS"'));

// Pin CLAY_WORKSPACE_ID via env so the mismatched --workspace flag below trips
// the pinned_workspace drift check (env pin always wins once a pin exists).
const wrongWorkspace = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'preflight-sample-run.js'),
  packetPath,
  '--workspace',
  '999999',
  '--folder',
  'f_TEST_FOLDER',
  '--workbook',
  'wb_TEST_WORKBOOK',
], { encoding: 'utf8', env: { CLAY_WORKSPACE_ID: 'TEST_WS' } }));
assert.strictEqual(wrongWorkspace.readiness.readyForConfirmation, false);
assert.strictEqual(wrongWorkspace.readiness.workspaceCheck.passed, false);

console.log(JSON.stringify({ ok: true, checked: 'sample-run-preflight' }, null, 2));

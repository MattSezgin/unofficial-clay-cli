#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const runDir = path.join(root, 'runs', 'test-template-plan');
fs.mkdirSync(runDir, { recursive: true });

function prepare(args) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(root, 'prepare-sample-run.js'),
    ...args,
    '--json',
  ], { encoding: 'utf8', env: {} }));
}

const readyDir = path.join(runDir, 'prepared-ready');
const ready = prepare([
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
  readyDir,
]);

assert.strictEqual(ready.mode, 'offline-prepared-sample-run');
assert.strictEqual(ready.selectedPlaybook.id, 'outbound-personalization');
assert.strictEqual(ready.readiness.status, 'ready_for_first_live_command_confirmation');
assert.strictEqual(ready.readiness.readyForFirstLiveCommand, true);
assert.strictEqual(ready.readiness.firstLiveCommandId, 'apply_sample_spec');
assert.deepStrictEqual(ready.issues, []);
for (const key of ['intake', 'plan', 'sampleRunPacket', 'preflight', 'manifest']) {
  assert(ready.artifacts[key], `missing artifact path: ${key}`);
  assert(fs.existsSync(path.join(root, ready.artifacts[key])), `missing artifact file: ${key}`);
}
const preflight = JSON.parse(fs.readFileSync(path.join(root, ready.artifacts.preflight), 'utf8'));
assert.strictEqual(preflight.readiness.readyForFirstLiveCommand, true);
assert.strictEqual(preflight.readiness.profileCheck.valid, true);
assert(preflight.liveCommands.some(command => command.command.includes('--workspace "TEST_WS"')));
const preparedPlan = JSON.parse(fs.readFileSync(path.join(root, ready.artifacts.plan), 'utf8'));
assert.strictEqual(preparedPlan.promptContract.id, 'outbound-personalization');
assert.strictEqual(preparedPlan.promptContract.valuesIncluded, false);
const preparedPacket = JSON.parse(fs.readFileSync(path.join(root, ready.artifacts.sampleRunPacket), 'utf8'));
assert.strictEqual(preparedPacket.promptContract.id, 'outbound-personalization');
assert(!JSON.stringify(ready).includes('Example Co'), 'prepared manifest should not include row values');

const missingDir = path.join(runDir, 'prepared-missing-inputs');
const missing = prepare([
  '--request',
  'Find people from job titles, company names, and domain addresses. Test 10 companies first.',
  '--out-dir',
  missingDir,
]);
assert.strictEqual(missing.selectedPlaybook.id, 'people-from-companies');
assert.strictEqual(missing.readiness.readyForFirstLiveCommand, false);
assert.strictEqual(missing.readiness.status, 'not_ready');
assert(missing.inputSummary.missingRequired.includes('company_name'));
assert(missing.inputSummary.missingRequired.includes('target_job_titles'));
assert(missing.issues.some(issue => issue.type === 'missing_required_inputs'));
assert(missing.artifacts.intake);
assert(missing.artifacts.plan);
assert(!missing.artifacts.sampleRunPacket);
assert(!missing.artifacts.preflight);

const peopleReadyDir = path.join(runDir, 'prepared-people-source-ready');
const peopleReady = prepare([
  '--request',
  'Find people from job titles, company names, and domain addresses. First dedupe companies, test company domain and LinkedIn discovery on 5 to 10 companies, then find people by job title at verified companies.',
  '--inputs',
  path.join(root, 'examples', 'people-from-companies-input.example.yaml'),
  '--config',
  path.join(root, 'config.example.yaml'),
  '--profile',
  'yourTestProfile',
  '--workspace',
  'TEST_WS',
  '--folder',
  'f_TEST_FOLDER',
  '--out-dir',
  peopleReadyDir,
]);
assert.strictEqual(peopleReady.selectedPlaybook.id, 'people-from-companies');
assert.strictEqual(peopleReady.template, 'people-from-companies-company-source.yaml');
assert.strictEqual(peopleReady.readiness.status, 'ready_for_first_live_command_confirmation');
assert.strictEqual(peopleReady.readiness.firstLiveCommandId, 'preview_source_sample');
assert.strictEqual(peopleReady.readiness.profileCheck.valid, true);

const ambiguous = prepare([
  '--request',
  'Build a Clay workflow',
  '--out-dir',
  path.join(runDir, 'prepared-ambiguous'),
]);
assert.strictEqual(ambiguous.readiness.readyForFirstLiveCommand, false);
assert(ambiguous.issues.some(issue => issue.type === 'routing_ambiguity'));

console.log(JSON.stringify({ ok: true, checked: 'prepared-sample-run' }, null, 2));

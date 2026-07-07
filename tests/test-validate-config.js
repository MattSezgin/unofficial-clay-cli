#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = path.join(__dirname, '..');
const configPath = path.join(root, 'config.example.yaml');
const runDir = path.join(root, 'runs', 'test-template-plan');
fs.mkdirSync(runDir, { recursive: true });

function run(args, opts = {}) {
  return execFileSync(process.execPath, [
    path.join(root, 'lib', 'validate-config.js'),
    ...args,
  ], { encoding: 'utf8', env: opts.env || {} });
}

function runJson(args, opts = {}) {
  return JSON.parse(run(args, opts));
}

const publicTemplate = runJson([configPath, '--profile', 'default']);
assert.strictEqual(publicTemplate.valid, true);
assert(publicTemplate.unresolved.includes('$.workspaceId'));
assert(publicTemplate.issues.every(issue => issue.severity !== 'error'));
assert(publicTemplate.resolved.requireChatConfirmationFor.includes('source-preview'));

let strictFailed = false;
try {
  run([configPath, '--profile', 'default', '--require-resolved']);
} catch (error) {
  strictFailed = true;
  const result = JSON.parse(error.stdout);
  assert.strictEqual(result.valid, false);
  assert(result.issues.some(issue => issue.type === 'unresolved_placeholder'));
}
assert(strictFailed, 'strict example config should fail without runtime values');

// --require-pinned-scope compares the resolved profile against the
// operator's pinned CLAY_WORKSPACE_ID/CLAY_FOLDER_ID env values, so these
// calls must pin a matching synthetic scope to stay hermetic.
const pinnedScopeEnv = { CLAY_WORKSPACE_ID: 'TEST_WS', CLAY_FOLDER_ID: 'f_TEST_FOLDER' };
const resolved = runJson([
  configPath,
  '--profile',
  'yourTestProfile',
  '--require-resolved',
  '--require-pinned-scope',
  '--workspace',
  'TEST_WS',
  '--folder',
  'f_TEST_FOLDER',
  '--workbook',
  'wb_TEST_WORKBOOK',
], { env: pinnedScopeEnv });
assert.strictEqual(resolved.valid, true);
assert.strictEqual(resolved.resolved.workspaceId, 'TEST_WS');
assert.strictEqual(resolved.resolved.testFolderId, 'f_TEST_FOLDER');
assert.strictEqual(resolved.resolved.defaultWorkbookId, 'wb_TEST_WORKBOOK');

const resolvedSourceOnly = runJson([
  configPath,
  '--profile',
  'yourTestProfile',
  '--require-resolved',
  '--require-pinned-scope',
  '--workspace',
  'TEST_WS',
  '--folder',
  'f_TEST_FOLDER',
  '--no-require-workbook',
], { env: pinnedScopeEnv });
assert.strictEqual(resolvedSourceOnly.valid, true);
assert.strictEqual(resolvedSourceOnly.resolved.workspaceId, 'TEST_WS');
assert.strictEqual(resolvedSourceOnly.resolved.testFolderId, 'f_TEST_FOLDER');

const badConfigPath = path.join(runDir, 'bad-config.yaml');
fs.writeFileSync(badConfigPath, YAML.stringify({
  profiles: {
    bad: {
      workspaceId: 'TEST_WS',
      testFolderId: 'f_TEST_FOLDER',
      defaultWorkbookId: 'wb_TEST_WORKBOOK',
      maxSampleRows: 10,
      claysession: 's%3AthisLooksLikeAClaySessionCookieValueForTestsOnly',
      requireChatConfirmationFor: ['mutating', 'credit-consuming', 'source-preview', 'source-import'],
    },
  },
}));

let secretFailed = false;
try {
  run([badConfigPath, '--profile', 'bad', '--require-resolved', '--require-pinned-scope']);
} catch (error) {
  secretFailed = true;
  const result = JSON.parse(error.stdout);
  assert.strictEqual(result.valid, false);
  assert(result.issues.some(issue => issue.type === 'secret_like_value'));
}
assert(secretFailed, 'secret-like config should fail');

const packetPath = path.join(runDir, 'config-preflight-sample-run-packet.json');
const preflightPath = path.join(runDir, 'config-preflight-ready.json');
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

const preflightWrite = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'lib', 'preflight-sample-run.js'),
  packetPath,
  '--config',
  configPath,
  '--profile',
  'yourTestProfile',
  '--workspace',
  'TEST_WS',
  '--folder',
  'f_TEST_FOLDER',
  '--workbook',
  'wb_TEST_WORKBOOK',
  '--out',
  preflightPath,
], { encoding: 'utf8', env: {} }));
assert(preflightWrite.wrote.endsWith('config-preflight-ready.json'));
const preflight = JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
assert.strictEqual(preflight.readiness.profileCheck.valid, true);
assert.strictEqual(preflight.readiness.readyForFirstLiveCommand, true);
assert.deepStrictEqual(preflight.readiness.missingRuntime, []);

console.log(JSON.stringify({ ok: true, checked: 'config-validation' }, null, 2));

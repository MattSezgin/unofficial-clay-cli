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

function runJson(args, opts = {}) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(root, 'lib', 'profile-context.js'),
    ...args,
  ], { encoding: 'utf8', env: opts.env || {} }));
}

const publicContext = runJson([configPath, '--profile', 'default', '--json']);
assert.strictEqual(publicContext.mode, 'offline-profile-context');
assert.strictEqual(publicContext.valid, true);
assert(publicContext.env.referenced.includes('CLAY_WORKSPACE_ID'));
assert(publicContext.env.missing.includes('CLAY_WORKSPACE_ID'));
assert.strictEqual(publicContext.runtime.workspaceId.state, 'unresolved');
assert.strictEqual(publicContext.safety.rawValuesPrinted, false);

const workspaceId = 'TEST_WS';
const folderId = 'f_TEST_SAFE_FOLDER_ALIAS';
const workbookId = 'wb_TEST_SAFE_WORKBOOK_ALIAS';
const resolvedContextRaw = execFileSync(process.execPath, [
  path.join(root, 'lib', 'profile-context.js'),
  configPath,
  '--profile',
  'yourTestProfile',
  '--require-resolved',
  '--workspace',
  workspaceId,
  '--folder',
  folderId,
  '--workbook',
  workbookId,
  '--json',
], { encoding: 'utf8', env: {} });
const resolvedContext = JSON.parse(resolvedContextRaw);
assert.strictEqual(resolvedContext.valid, true);
assert.strictEqual(resolvedContext.runtime.workspaceId.display, `<redacted:${workspaceId.length}>`);
assert.strictEqual(resolvedContext.runtime.testFolderId.display, `<redacted:${folderId.length}>`);
assert.strictEqual(resolvedContext.runtime.defaultWorkbookId.display, `<redacted:${workbookId.length}>`);
assert(!resolvedContextRaw.includes(folderId), 'folder ID should not be printed raw');
assert(!resolvedContextRaw.includes(workbookId), 'workbook ID should not be printed raw');

const envOverrideContextRaw = execFileSync(process.execPath, [
  path.join(root, 'lib', 'profile-context.js'),
  configPath,
  '--profile',
  'default',
  '--require-resolved',
  '--env',
  'CLAY_WORKSPACE_ID=workspace_from_env_override',
  '--env',
  'CLAY_TEST_FOLDER_ID=folder_from_env_override',
  '--env',
  'CLAY_DEFAULT_WORKBOOK_ID=workbook_from_env_override',
  '--json',
], { encoding: 'utf8', env: {} });
const envOverrideContext = JSON.parse(envOverrideContextRaw);
assert.strictEqual(envOverrideContext.valid, true);
assert.deepStrictEqual(envOverrideContext.env.missing, []);
assert(envOverrideContext.env.status.every(item => item.value && item.value.startsWith('<redacted:')));
assert(!envOverrideContextRaw.includes('workspace_from_env_override'));
assert(!envOverrideContextRaw.includes('folder_from_env_override'));
assert(!envOverrideContextRaw.includes('workbook_from_env_override'));

const wrongConfigPath = path.join(runDir, 'profile-context-wrong.yaml');
fs.writeFileSync(wrongConfigPath, YAML.stringify({
  profiles: {
    wrong: {
      workspaceId: 'wrong_workspace_should_not_print',
      testFolderId: 'wrong_folder_should_not_print',
      defaultWorkbookId: 'wrong_workbook_should_not_print',
      maxSampleRows: 10,
      requireChatConfirmationFor: ['mutating', 'credit-consuming', 'source-preview', 'source-import'],
    },
  },
}));
// require-pinned-scope compares the resolved profile against the operator's
// pinned CLAY_WORKSPACE_ID env value, so pin one here that deliberately
// differs from the fixture's workspaceId to exercise the mismatch path.
const wrongContextRaw = execFileSync(process.execPath, [
  path.join(root, 'lib', 'profile-context.js'),
  wrongConfigPath,
  '--profile',
  'wrong',
  '--require-pinned-scope',
  '--json',
], { encoding: 'utf8', env: { CLAY_WORKSPACE_ID: 'TEST_WS' } });
const wrongContext = JSON.parse(wrongContextRaw);
assert.strictEqual(wrongContext.valid, false);
assert(wrongContext.issues.some(issue => issue.type === 'wrong_workspace'));
assert(!wrongContextRaw.includes('wrong_workspace_should_not_print'));
assert(!wrongContextRaw.includes('wrong_folder_should_not_print'));
assert(!wrongContextRaw.includes('wrong_workbook_should_not_print'));

console.log(JSON.stringify({ ok: true, checked: 'profile-context' }, null, 2));

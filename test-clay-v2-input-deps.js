#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Hermetic regardless of ambient env: apply-spec --dry-run still enforces the
// env-driven write-scope guard, so pin a synthetic workspace for this test.
process.env.CLAY_WORKSPACE_ID = 'TEST_WS';

const cli = path.join(__dirname, 'clay-v2.js');
const prompt = '"Company: " + Clay.formatForAIPrompt({{f_company}}) + " Domain: " + Clay.formatForAIPrompt({{f_domain}})';
const out = JSON.parse(execFileSync(process.execPath, [
  cli, 'create-field', 't_fake',
  '--name', 'AI',
  '--type', 'use-ai',
  '--useCase', 'claygent',
  '--model', 'clay-argon',
  '--prompt', prompt,
  '--run-condition', "{{f_ready}} === 'Yes'",
  '--outputs', 'linkedin_url:text:linkedin_url,confidence:text:confidence',
  '--dry-run'
], { encoding: 'utf8' }));

const ids = out.request.body.inputFieldIds.sort();
assert.deepStrictEqual(ids, ['f_company', 'f_domain', 'f_ready'].sort());

const actionOut = JSON.parse(execFileSync(process.execPath, [
  cli, 'create-action', 't_fake',
  '--name', 'Company Mixrank',
  '--action-key', 'enrich-company-with-mixrank-v2',
  '--package-id', 'e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2',
  '--inputs-json', JSON.stringify({ company_identifier: '{{Company Domain}}' }),
  '--run-condition', '!!{{Company Domain}}',
  '--field-map-json', JSON.stringify({ 'Company Domain': 'f_domain' }),
  '--dry-run'
], { encoding: 'utf8' }));
assert.strictEqual(actionOut.request.body.typeSettings.inputsBinding[0].formulaText, '{{f_domain}}');
assert.strictEqual(actionOut.request.body.typeSettings.conditionalRunFormulaText, '!!{{f_domain}}');
assert.deepStrictEqual(actionOut.request.body.inputFieldIds, ['f_domain']);

const specPath = path.join(__dirname, 'runs', 'tmp-apply-spec-dependency-test.json');
fs.mkdirSync(path.dirname(specPath), { recursive: true });
fs.writeFileSync(specPath, JSON.stringify({
  workspaceId: 'TEST_WS',
  folderId: 'f_TEST_FOLDER',
  table: { id: 't_fake', name: 'Fake' },
  fields: [
    {
      name: 'Company Mixrank',
      type: 'action',
      actionKey: 'enrich-company-with-mixrank-v2',
      actionPackageId: 'e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2',
      inputs: { company_identifier: '{{Company Domain}}' },
      runCondition: '!!{{Company Domain}}',
    },
  ],
}, null, 2));
const applyOut = JSON.parse(execFileSync(process.execPath, [
  cli, 'apply-spec', specPath,
  '--field-map-json', JSON.stringify({ 'Company Domain': 'f_domain' }),
  '--dry-run'
], { encoding: 'utf8' }));
assert.strictEqual(applyOut.dependencyPlans[0].inputBindings[0].formulaText, '{{f_domain}}');
assert.strictEqual(applyOut.dependencyPlans[0].runCondition, '!!{{f_domain}}');
assert.deepStrictEqual(applyOut.dependencyPlans[0].expectedInputFieldIds, ['f_domain']);
fs.unlinkSync(specPath);

console.log(JSON.stringify({ ok: true, checked: 'clay-v2-input-deps' }, null, 2));

#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const YAML = require('yaml');

const cli = path.join(__dirname, 'clay-v2.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-model-compat-'));

function writeSpec(name, useCase) {
  const file = path.join(tmp, `${name}.yaml`);
  fs.writeFileSync(file, YAML.stringify({
    claySpecVersion: 1,
    workspaceId: 'TEST_WS',
    table: { name: `model-compat-${name}` },
    fields: [{
      name: 'AI',
      type: 'action',
      actionKey: 'use-ai',
      actionPackageId: '67ba01e9-1898-4e7d-afe7-7ebe24819a57',
      inputs: {
        useCase: JSON.stringify(useCase),
        model: JSON.stringify('clay-argon'),
        prompt: JSON.stringify('Return JSON.')
      },
      outputs: [{ name: 'status', type: 'text', path: 'status' }]
    }]
  }));
  return file;
}

const bad = JSON.parse(execFileSync(process.execPath, [cli, 'validate-spec', writeSpec('bad', 'use-ai')], { encoding: 'utf8' }));
assert.strictEqual(bad.valid, false, 'clay-argon + use-ai should fail validation');
assert(bad.issues.some(issue => issue.type === 'use_ai_model_usecase_incompatible'), 'expected compatibility issue');

const good = JSON.parse(execFileSync(process.execPath, [cli, 'validate-spec', writeSpec('good', 'claygent')], { encoding: 'utf8' }));
assert(!good.issues.some(issue => issue.type === 'use_ai_model_usecase_incompatible'), 'clay-argon + claygent should not raise compatibility issue');

console.log(JSON.stringify({ ok: true, checked: 'clay-v2-model-compat' }, null, 2));

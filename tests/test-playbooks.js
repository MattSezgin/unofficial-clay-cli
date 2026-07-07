#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const dir = path.join(__dirname, '..', 'playbooks');
const files = fs.readdirSync(dir)
  .filter(file => file.endsWith('.yaml'))
  .map(file => path.join(dir, file));

assert(files.length > 0, 'expected at least one playbook');

const forbiddenPatterns = [
  /claysession/i,
  /apiToken/i,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /sk-[A-Za-z0-9._-]+/i,
  /https:\/\/hooks\.slack\.com\//i,
  /https:\/\/api\.clay\.com\/v3\/sources\/webhook/i,
  /\baa_[A-Za-z0-9]+\b/,
  /\bwb_0[A-Za-z0-9]+\b/,
  /\bt_0[A-Za-z0-9]+\b/,
  /\bgv_0[A-Za-z0-9]+\b/,
  /\bf_0[A-Za-z0-9]+\b/,
];

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const doc = YAML.parse(raw);
  assert(doc.playbookVersion, `${file}: missing playbookVersion`);
  assert(doc.id, `${file}: missing id`);
  assert(doc.name, `${file}: missing name`);
  assert(doc.purpose, `${file}: missing purpose`);
  assert(doc.variables && typeof doc.variables === 'object', `${file}: missing variables`);
  assert(doc.sampleRows && Number(doc.sampleRows.max) <= 10, `${file}: sampleRows.max must be <= 10`);
  assert(doc.safety && Array.isArray(doc.safety.requiresChatConfirmation), `${file}: missing safety.requiresChatConfirmation`);
  assert(Array.isArray(doc.workflow) && doc.workflow.length > 0, `${file}: missing workflow steps`);
  assert(doc.outputs && (doc.outputs.readyColumns || doc.outputs.qaViews), `${file}: missing outputs`);
  assert(Array.isArray(doc.knownFailureModes) && doc.knownFailureModes.length > 0, `${file}: missing knownFailureModes`);
  for (const pattern of forbiddenPatterns) {
    assert(!pattern.test(raw), `${file}: forbidden private/secret-looking value matched ${pattern}`);
  }
}

console.log(JSON.stringify({ ok: true, checked: files.length, files: files.map(f => path.basename(f)) }, null, 2));

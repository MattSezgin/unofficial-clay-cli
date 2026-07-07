#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = __dirname;
const playbookDir = path.join(root, 'playbooks');
const promptDir = path.join(root, 'prompts');
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
  /s%3A[A-Za-z0-9._-]{20,}/i,
];

const playbooks = fs.readdirSync(playbookDir)
  .filter(file => file.endsWith('.yaml'))
  .map(file => YAML.parse(fs.readFileSync(path.join(playbookDir, file), 'utf8')));
const promptFiles = fs.readdirSync(promptDir)
  .filter(file => file.endsWith('.yaml'))
  .sort();
const prompts = promptFiles.map(file => ({
  file,
  raw: fs.readFileSync(path.join(promptDir, file), 'utf8'),
  doc: YAML.parse(fs.readFileSync(path.join(promptDir, file), 'utf8')),
}));

assert.strictEqual(prompts.length, playbooks.length, 'expected one prompt contract per playbook');

for (const playbook of playbooks) {
  const match = prompts.find(item => item.doc.playbookId === playbook.id);
  assert(match, `missing prompt contract for playbook ${playbook.id}`);
  assert.strictEqual(match.doc.id, playbook.id, `${match.file}: id should match playbook id`);
  assert(match.doc.promptVersion, `${match.file}: missing promptVersion`);
  assert(match.doc.name, `${match.file}: missing name`);
  assert(match.doc.purpose, `${match.file}: missing purpose`);
  assert(match.doc.systemPrompt, `${match.file}: missing systemPrompt`);
  assert(match.doc.taskPrompt, `${match.file}: missing taskPrompt`);
  assert(Array.isArray(match.doc.guardrails) && match.doc.guardrails.length >= 3, `${match.file}: expected guardrails`);
  assert(match.doc.outputSchema && Object.keys(match.doc.outputSchema).length >= 3, `${match.file}: expected outputSchema`);
  assert(Array.isArray(match.doc.qaChecks) && match.doc.qaChecks.length >= 2, `${match.file}: expected qaChecks`);
  assert(match.doc.valuePolicy && /omit|redacted|never commit/i.test(match.doc.valuePolicy), `${match.file}: valuePolicy should be explicit`);
  for (const pattern of forbiddenPatterns) {
    assert(!pattern.test(match.raw), `${match.file}: forbidden private/secret-looking value matched ${pattern}`);
  }
}

const index = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'prompt-library.js'),
  '--list',
  '--json',
], { encoding: 'utf8', env: {} }));
assert.strictEqual(index.mode, 'offline-prompt-library-index');
assert.strictEqual(index.count, playbooks.length);
assert(index.prompts.every(prompt => prompt.guardrailCount >= 3));

const packetRaw = execFileSync(process.execPath, [
  path.join(root, 'prompt-library.js'),
  '--playbook',
  'outbound-personalization',
  '--json',
], { encoding: 'utf8', env: {} });
const packet = JSON.parse(packetRaw);
assert.strictEqual(packet.mode, 'offline-prompt-contract');
assert.strictEqual(packet.prompt.playbookId, 'outbound-personalization');
assert.strictEqual(packet.valuesIncluded, false);
assert(packet.guardrails.some(rule => rule.includes('invent')));
assert(!packetRaw.includes('Example Co'), 'prompt packet should not include row values');

console.log(JSON.stringify({ ok: true, checked: 'prompt-library', prompts: prompts.length }, null, 2));

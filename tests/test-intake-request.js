#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runDir = path.join(root, 'runs', 'test-template-plan');
fs.mkdirSync(runDir, { recursive: true });

function intake(args) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(root, 'lib', 'intake-request.js'),
    ...args,
    '--json',
  ], { encoding: 'utf8', env: {} }));
}

const people = intake([
  '--request',
  'Find people from job titles, company names, and domain addresses. Test 10 companies first, then find LinkedIn profiles.',
]);
assert.strictEqual(people.mode, 'offline-request-intake');
assert.strictEqual(people.routing.selectedPlaybook.id, 'people-from-companies');
assert.notStrictEqual(people.routing.ambiguity, 'review-required');
assert(people.inputSummary.missingRequired.includes('company_name'));
assert(people.inputSummary.missingRequired.includes('target_job_titles'));
assert(people.missingInputQuestions.some(item => item.key === 'company_name'));
assert(people.nextCommands.plan.includes('playbooks/people-from-companies.yaml'));
assert(people.nextCommands.sampleRunPacket.includes('--sample-run people-from-companies'));
assert(!JSON.stringify(people).includes('s%3A'), 'intake must not include Clay session material');

const outbound = intake([
  '--request',
  'Build a campaign personalization table for cold email with opener angles, persona, company domain, and QA fields.',
]);
assert.strictEqual(outbound.routing.selectedPlaybook.id, 'outbound-personalization');
assert(outbound.routing.selectedPlaybook.score > outbound.routing.alternatives[0].score);
assert(outbound.inputSummary.missingRequired.includes('company_name'));
assert(outbound.inputSummary.missingRequired.includes('company_domain'));
assert(outbound.inputSummary.missingRequired.includes('persona_or_title'));

const ready = intake([
  '--request',
  'Build a campaign personalization table for cold email with opener angles.',
  '--inputs',
  path.join(root, 'examples', 'outbound-personalization-input.example.yaml'),
]);
assert.strictEqual(ready.routing.selectedPlaybook.id, 'outbound-personalization');
assert.strictEqual(ready.inputSummary.readyForSamplePlan, true);
assert.deepStrictEqual(ready.inputSummary.missingRequired, []);
assert.strictEqual(ready.missingInputQuestions.length, 0);
assert(ready.nextCommands.plan.includes('--inputs examples/outbound-personalization-input.example.yaml'));

const ambiguous = intake(['--request', 'Build a Clay workflow']);
assert.strictEqual(ambiguous.routing.ambiguity, 'review-required');
assert(ambiguous.routing.alternatives.length >= 3);

const outPath = path.join(runDir, 'request-intake.json');
const writeResult = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'lib', 'intake-request.js'),
  '--request',
  'Audit and clone an existing Clay table and create a repair plan.',
  '--out',
  outPath,
], { encoding: 'utf8', env: {} }));
assert(writeResult.wrote.endsWith('request-intake.json'));
const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
assert.strictEqual(written.routing.selectedPlaybook.id, 'table-audit-clone');

console.log(JSON.stringify({ ok: true, checked: 'request-intake' }, null, 2));

#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const plan = execFileSync(process.execPath, [
  path.join(root, 'lib', 'plan-playbook.js'),
  path.join(root, 'playbooks', 'outbound-personalization.yaml'),
  '--inputs',
  path.join(root, 'examples', 'outbound-personalization-input.example.yaml'),
  '--spec',
  'specs/templates/outbound-personalization.yaml',
  '--json',
], { encoding: 'utf8' });

const report = execFileSync(process.execPath, [
  path.join(root, 'lib', 'quality-report.js'),
  '-',
], { input: plan, encoding: 'utf8' });

const evidenceReport = execFileSync(process.execPath, [
  path.join(root, 'lib', 'quality-report.js'),
  '-',
  '--evidence',
  path.join(__dirname, 'fixtures', 'quality-fixture.json'),
], { input: plan, encoding: 'utf8' });

assert(report.includes('# Clay Sample Quality Report'));
assert(report.includes('outbound-personalization'));
assert(report.includes('Offline Plan Evidence'));
assert(report.includes('specs/templates/outbound-personalization.yaml'));
assert(report.includes('confirmation: required'));
assert(report.includes('## Scale Gate'));
assert(report.includes('userConfirmedScale'));
assert(report.includes('User confirmed exact scale command: no'));
assert(report.includes('Continue / Stop Decision'));
assert(report.includes('Second confirmation received for scale: no'));
assert(!report.includes('Example Co'), 'report should not include row values');

assert(evidenceReport.includes('Rows tested: 10'));
assert(evidenceReport.includes('Credit-consuming fields run: 1'));
assert(evidenceReport.includes('Table ID: t_TEST_SAMPLE_TABLE'));
assert(evidenceReport.includes('View ID: gv_TEST_SAMPLE_VIEW'));
assert(evidenceReport.includes('Recommendation: continue'));
assert(evidenceReport.includes('First-run gate passed: yes'));
assert(evidenceReport.includes('Evidence provenance kind: clay-evidence-bundle'));
assert(evidenceReport.includes('Evidence source artifact hash: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'));
assert(evidenceReport.includes('Evidence source command count: 2'));
assert(evidenceReport.includes('run_action_sample_1: node clay-v2.js run-top t_TEST_SAMPLE_TABLE'));
assert(evidenceReport.includes('Required fixes before scale: none in fake fixture'));
assert(!evidenceReport.includes('Example Co'), 'evidence report should not include row values');

console.log(JSON.stringify({ ok: true, checked: 'quality-report-template' }, null, 2));

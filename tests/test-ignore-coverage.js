#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const gitignorePath = path.join(root, '.gitignore');
assert(fs.existsSync(gitignorePath), 'expected package-local .gitignore');

const raw = fs.readFileSync(gitignorePath, 'utf8');
const lines = raw
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

function hasPattern(pattern) {
  return lines.includes(pattern);
}

for (const pattern of [
  'node_modules/',
  '.env',
  '.env.*',
  '.envrc',
  'config.local.yaml',
  'config.local.json',
  '.clay-session*',
  '.clay-session.json',
  'runs/',
  'exports/',
  '*-sample-run.json',
  '*-prepared-sample-run.json',
  '*-preflight.json',
  '*-hydrated-sample-run.json',
  '*-advanced-sample-run.json',
  '*-evidence.json',
  '*-scale-gate.json',
  '*-quality-report.md',
  '*.raw.yaml',
  '*.raw.json',
  '*.har',
  '*.jsonl',
  '*.png',
  '*.csv',
  '*.xlsx',
  '*.db',
  '.DS_Store',
]) {
  assert(hasPattern(pattern), `.gitignore missing required pattern: ${pattern}`);
}

assert(raw.includes('claysession'), '.gitignore should guard Clay session naming variants');
assert(raw.includes('Browser/network captures'), '.gitignore should document browser/network capture artifacts');
assert(raw.includes('contacts or PII'), '.gitignore should document data-file risk');

console.log(JSON.stringify({ ok: true, checked: 'ignore-coverage', patterns: lines.length }, null, 2));

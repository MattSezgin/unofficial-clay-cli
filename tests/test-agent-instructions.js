#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'AGENTS.md');
assert(fs.existsSync(file), 'expected package-local AGENTS.md');
const raw = fs.readFileSync(file, 'utf8');

for (const phrase of [
  'explicit chat confirmation',
  'exact command',
  'Do not use `--confirm`',
  '10 rows',
  'scale-gate.js',
  'ready_for_second_scale_confirmation',
  'session cookies',
  'runs/',
  'simulate-full-loop.js',
  'profile-context.js',
  'raw workbook/folder/profile IDs',
  'offline simulator is fake evidence',
  'real confirmed sample run',
  'Do not push branches, open PRs, edit or close GitHub issues',
]) {
  assert(raw.includes(phrase), `AGENTS.md missing required phrase: ${phrase}`);
}

assert(!/\bwb_0[A-Za-z0-9]+\b/.test(raw), 'AGENTS.md must not include private workbook IDs');
assert(!/\bt_0[A-Za-z0-9]+\b/.test(raw), 'AGENTS.md must not include private table IDs');
assert(!/\bgv_0[A-Za-z0-9]+\b/.test(raw), 'AGENTS.md must not include private view IDs');
assert(!/\bf_0[A-Za-z0-9]+\b/.test(raw), 'AGENTS.md must not include private folder IDs');
assert(!/s%3A[A-Za-z0-9._-]{20,}/i.test(raw), 'AGENTS.md must not include Clay session material');

console.log(JSON.stringify({ ok: true, checked: 'agent-instructions' }, null, 2));

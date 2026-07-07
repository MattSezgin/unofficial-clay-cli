#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const cli = path.join(__dirname, 'clay-v2.js');
const fixture = path.join(__dirname, 'test', 'redaction-input.json');
const output = execFileSync(process.execPath, [cli, 'redact', fixture], { encoding: 'utf8' });
const redacted = JSON.parse(output);
const text = JSON.stringify(redacted);

for (const forbidden of [
  'claysession=FAKE_SESSION_COOKIE',
  'aa_FAKEAPPACCOUNT123',
  'apiToken-secret',
  'https://hooks.slack.com/services/T000/B000/FAKESECRET',
  'https://api.clay.com/v3/sources/webhook/FAKEWEBHOOK',
  'sk-FAKEOPENAIKEY123456',
  'api_key=FAKE_QUERY_KEY_12345',
  'api=FAKE_BARE_QUERY_KEY_12345',
  'google-sheet-id-fake-123',
]) {
  assert(!text.includes(forbidden), `redaction missed ${forbidden}`);
}

assert(text.includes('<redacted:'), 'expected stable redaction markers');
assert.strictEqual(redacted.safeField, 'keep me');
console.log(JSON.stringify({ ok: true, checked: 'redaction-fixture' }, null, 2));

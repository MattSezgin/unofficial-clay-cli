#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PROOF_PACKET_VERSION,
  STRICT_PASS_REQUIREMENTS,
  createProofPacket,
  validateProofPacket,
  writeProofPacket,
  redactedClone,
} = require('./proof-packet');

const strictProofRequirements = Object.fromEntries(STRICT_PASS_REQUIREMENTS.map(key => [key, true]));
const passedPacket = createProofPacket({
  actionKey: 'http-api-v2',
  outcome: 'passed',
  scope: { workspaceId: 'TEST_WS', workbookId: 'wb_test', tableId: 't_test', viewId: 'gv_test' },
  field: { id: 'f_test', name: 'HTTP Proof', actionKey: 'http-api-v2' },
  rowLimit: 3,
  configReadback: { actionKey: 'http-api-v2', settingsError: null, authAccountId: 'secret-auth-id' },
  runReadback: { statusCounts: { SUCCESS: 3 }, unresolvedRuntimeErrors: [] },
  parentOutputInspection: { inspectedRows: 3, rowsWithFullValue: 3, sampleFullValueKeys: ['slideshow', 'title'] },
  extractedOutputs: [{ id: 'f_out', name: 'Title', path: ['slideshow', 'title'], nonEmptyCount: 3 }],
  valueQa: { passed: true, checks: [{ type: 'non_empty', passed: true, field: 'Title' }] },
  statusSemantics: { documented: true, notes: ['SUCCESS means public endpoint returned JSON.'] },
  strictProofRequirements,
  artifacts: ['runs/test/proof.json?api_key=should-redact'],
});

assert.strictEqual(passedPacket.version, PROOF_PACKET_VERSION);
assert.strictEqual(passedPacket.configReadback.authAccountId, '[REDACTED]');
assert(JSON.stringify(passedPacket).includes('[REDACTED]'));
assert(!JSON.stringify(passedPacket).includes('should-redact'));
assert.strictEqual(validateProofPacket(passedPacket).valid, true);

const missingParent = createProofPacket({
  ...passedPacket,
  parentOutputInspection: { inspectedRows: 3, rowsWithFullValue: 0, sampleFullValueKeys: [] },
});
assert(validateProofPacket(missingParent).issues.some(issue => issue.type === 'passed_without_parent_full_value_keys'));

const tooManyRows = createProofPacket({ ...passedPacket, rowLimit: 11 });
assert(validateProofPacket(tooManyRows).issues.some(issue => issue.type === 'row_limit_exceeds_strict_proof_cap'));

const blocked = createProofPacket({
  actionKey: 'add-lead-to-campaign',
  outcome: 'blocked',
  scope: { workspaceId: 'TEST_WS', workbookId: 'wb_test', tableId: 't_test', viewId: 'gv_test' },
  field: { id: 'f_test', name: 'Add Lead', actionKey: 'add-lead-to-campaign' },
  rowLimit: 1,
  configReadback: {},
  runReadback: {},
  parentOutputInspection: {},
  extractedOutputs: [],
  valueQa: { passed: false, checks: [] },
  statusSemantics: { documented: true, notes: ['External mutation blocked until sandbox approved.'] },
  blockedReason: 'blocked_destructive_external_mutation',
});
assert.strictEqual(validateProofPacket(blocked).valid, true);

const redacted = redactedClone({ url: 'https://example.com/path?api_key=abc123&x=1', webhookUrl: 'https://example.com/webhook/secret' });
assert(!JSON.stringify(redacted).includes('abc123'));
assert.strictEqual(redacted.webhookUrl, '[REDACTED]');

const tmp = path.join(os.tmpdir(), `proof-packet-${Date.now()}.json`);
const written = writeProofPacket(tmp, passedPacket);
assert(fs.existsSync(tmp));
assert.strictEqual(written.validation.valid, true);

console.log(JSON.stringify({ ok: true, checked: 'proof-packet' }, null, 2));

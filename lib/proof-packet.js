const fs = require('fs');
const path = require('path');

const PROOF_PACKET_VERSION = '2026-06-09.v1';
const PROOF_OUTCOMES = new Set(['passed', 'failed', 'blocked', 'in_progress']);
const REQUIRED_PACKET_TOP_LEVEL = [
  'version',
  'actionKey',
  'outcome',
  'scope',
  'field',
  'rowLimit',
  'configReadback',
  'runReadback',
  'parentOutputInspection',
  'extractedOutputs',
  'valueQa',
  'statusSemantics',
  'redaction',
];
const STRICT_PASS_REQUIREMENTS = [
  'realDataRows',
  'configReadbackClean',
  'parentFullValueInspected',
  'parentFullValuePresent',
  'extractedOutputsCreated',
  'extractedValuesVerified',
  'statusSemanticsDocumented',
  'noUnresolvedProofPathErrors',
];

function redactedClone(value) {
  const seen = new WeakSet();
  const redactString = text => String(text)
    .replace(/(api[_-]?key=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(token=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(Authorization:\s*Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(authAccountId["']?\s*[:=]\s*["']?)[A-Za-z0-9_-]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s"']*webhook[^\s"']*/gi, '[REDACTED_WEBHOOK_URL]');
  const walk = input => {
    if (typeof input === 'string') return redactString(input);
    if (!input || typeof input !== 'object') return input;
    if (seen.has(input)) return '[Circular]';
    seen.add(input);
    if (Array.isArray(input)) return input.map(walk);
    const out = {};
    for (const [key, val] of Object.entries(input)) {
      if (/api[_-]?key|secret|token|authorization|webhookUrl|authAccountId/i.test(key)) out[key] = '[REDACTED]';
      else out[key] = walk(val);
    }
    return out;
  };
  return walk(value);
}

function validateProofPacket(packet) {
  const issues = [];
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return { valid: false, issueCount: 1, issues: [{ severity: 'error', type: 'invalid_packet', message: 'proof packet must be an object' }] };
  }
  for (const key of REQUIRED_PACKET_TOP_LEVEL) {
    if (!(key in packet)) issues.push({ severity: 'error', type: 'missing_top_level_key', key });
  }
  if (packet.version !== PROOF_PACKET_VERSION) issues.push({ severity: 'warning', type: 'unexpected_packet_version', expected: PROOF_PACKET_VERSION, actual: packet.version });
  if (!PROOF_OUTCOMES.has(packet.outcome)) issues.push({ severity: 'error', type: 'invalid_outcome', actual: packet.outcome });
  if (!packet.actionKey) issues.push({ severity: 'error', type: 'missing_action_key' });
  const rowLimit = Number(packet.rowLimit);
  if (!Number.isFinite(rowLimit) || rowLimit < 1) issues.push({ severity: 'error', type: 'invalid_row_limit', actual: packet.rowLimit });
  if (rowLimit > 10) issues.push({ severity: 'error', type: 'row_limit_exceeds_strict_proof_cap', actual: rowLimit, max: 10 });
  const scope = packet.scope || {};
  for (const key of ['workspaceId', 'workbookId', 'tableId', 'viewId']) {
    if (!scope[key]) issues.push({ severity: 'error', type: 'missing_scope_key', key });
  }
  const field = packet.field || {};
  if (!field.id || !field.name) issues.push({ severity: 'error', type: 'missing_field_identity' });
  if (packet.outcome === 'passed') {
    const requirements = packet.strictProofRequirements || {};
    for (const key of STRICT_PASS_REQUIREMENTS) {
      if (requirements[key] !== true) issues.push({ severity: 'error', type: 'missing_strict_pass_requirement', key });
    }
    if (!Array.isArray(packet.extractedOutputs) || packet.extractedOutputs.length === 0) {
      issues.push({ severity: 'error', type: 'passed_without_extracted_outputs' });
    }
    if (!packet.parentOutputInspection?.sampleFullValueKeys?.length) {
      issues.push({ severity: 'error', type: 'passed_without_parent_full_value_keys' });
    }
    if (packet.valueQa?.passed !== true) issues.push({ severity: 'error', type: 'passed_without_value_qa_pass' });
    if (packet.configReadback?.settingsError) issues.push({ severity: 'error', type: 'passed_with_settings_error', settingsError: packet.configReadback.settingsError });
    if (packet.runReadback?.unresolvedRuntimeErrors?.length) issues.push({ severity: 'error', type: 'passed_with_unresolved_runtime_errors' });
  }
  if (packet.outcome === 'blocked' && !packet.blockedReason) issues.push({ severity: 'error', type: 'blocked_without_reason' });
  if (!packet.redaction || packet.redaction.redacted !== true) issues.push({ severity: 'warning', type: 'redaction_not_confirmed' });
  return { valid: issues.every(issue => issue.severity !== 'error'), issueCount: issues.length, issues };
}

function createProofPacket(input = {}) {
  const now = input.createdAt || new Date().toISOString();
  const packet = {
    version: PROOF_PACKET_VERSION,
    createdAt: now,
    actionKey: input.actionKey,
    outcome: input.outcome || 'in_progress',
    scope: input.scope || {},
    field: input.field || {},
    rowLimit: Number(input.rowLimit || 10),
    configReadback: input.configReadback || {},
    runReadback: input.runReadback || {},
    parentOutputInspection: input.parentOutputInspection || {},
    extractedOutputs: input.extractedOutputs || [],
    valueQa: input.valueQa || { passed: false, checks: [] },
    statusSemantics: input.statusSemantics || { documented: false, notes: [] },
    strictProofRequirements: input.strictProofRequirements || {},
    failureModes: input.failureModes || [],
    blockedReason: input.blockedReason || null,
    artifacts: input.artifacts || [],
    redaction: { redacted: true, method: 'proof-packet.redactedClone' },
  };
  return redactedClone(packet);
}

function writeProofPacket(filePath, input = {}) {
  const packet = createProofPacket(input);
  const validation = validateProofPacket(packet);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ ...packet, validation }, null, 2));
  return { packet, validation, filePath };
}

module.exports = {
  PROOF_PACKET_VERSION,
  PROOF_OUTCOMES,
  STRICT_PASS_REQUIREMENTS,
  createProofPacket,
  validateProofPacket,
  writeProofPacket,
  redactedClone,
};

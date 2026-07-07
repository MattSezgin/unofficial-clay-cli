const { createProofPacket, validateProofPacket } = require('./proof-packet');

function getCellStatus(cell) {
  if (!cell || typeof cell !== 'object') return null;
  return cell.externalContent?.status || cell.metadata?.status || null;
}

function getCellFullValue(cell) {
  if (!cell || typeof cell !== 'object') return undefined;
  return cell.externalContent?.fullValue;
}

function isNonEmptyValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function topLevelKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).sort();
}

function fieldMappedPath(field) {
  const path = field?.typeSettings?.mappedResultPath;
  if (Array.isArray(path)) return path;
  return null;
}

function getPathValue(value, path = []) {
  let cur = value;
  for (const part of path) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function flattenObjectPaths(value, prefix = [], maxDepth = 3) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || prefix.length >= maxDepth) return [];
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const next = [...prefix, key];
    paths.push(next);
    if (child && typeof child === 'object' && !Array.isArray(child)) paths.push(...flattenObjectPaths(child, next, maxDepth));
  }
  return paths;
}

function suggestExtractedOutputPaths(fullValue, opts = {}) {
  const paths = flattenObjectPaths(fullValue, [], opts.maxDepth || 3);
  return paths.map(path => ({ path, name: path.join(' '), sampleValue: getPathValue(fullValue, path) })).filter(item => isNonEmptyValue(item.sampleValue));
}

function expectedShapeForOutput(output) {
  const text = `${output.name || ''} ${(output.path || []).join(' ')}`.toLowerCase();
  if (text.includes('email')) return 'email';
  if (text.includes('url') || text.includes('linkedin') || text.includes('website')) return 'url';
  return null;
}

function valueMatchesShape(value, shape) {
  if (!shape || !isNonEmptyValue(value)) return true;
  const text = String(value).trim();
  if (shape === 'email') return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text);
  if (shape === 'url') return /^https?:\/\//.test(text) || /^www\./.test(text);
  return true;
}

function findExtractedOutputFields(manifest, parentFieldId) {
  const fields = manifest?.table?.fields || [];
  return fields.filter(field => {
    const inputIds = field.inputFieldIds || [];
    const formula = field.typeSettings?.formulaText || '';
    return field.id !== parentFieldId && (inputIds.includes(parentFieldId) || formula.includes(`{{${parentFieldId}}}`)) && fieldMappedPath(field);
  });
}

function statusCountsForField(records = [], fieldId) {
  const counts = {};
  for (const record of records) {
    const status = getCellStatus(record.cells?.[fieldId]) || 'NO_STATUS';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function summarizeExtractedOutputs(manifest, parentFieldId, records = []) {
  const outputs = findExtractedOutputFields(manifest, parentFieldId);
  return outputs.map(field => {
    let nonEmptyCount = 0;
    let blankCount = 0;
    let invalidShapeCount = 0;
    const sampleValues = [];
    const path = fieldMappedPath(field);
    const shape = expectedShapeForOutput({ name: field.name, path });
    const statusCounts = statusCountsForField(records, field.id);
    for (const record of records) {
      const cell = record.cells?.[field.id];
      const direct = cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'value') ? cell.value : cell;
      if (isNonEmptyValue(direct)) {
        nonEmptyCount += 1;
        if (sampleValues.length < 10 && !sampleValues.includes(direct)) sampleValues.push(direct);
        if (!valueMatchesShape(direct, shape)) invalidShapeCount += 1;
      } else blankCount += 1;
    }
    return {
      id: field.id,
      name: field.name,
      path,
      expectedShape: shape,
      statusCounts,
      nonEmptyCount,
      blankCount,
      invalidShapeCount,
      sampleValues,
    };
  });
}

function enumValueQaChecks(extractedOutputs = [], expectedEnums = {}) {
  const checks = [];
  for (const output of extractedOutputs) {
    const pathKey = (output.path || []).join('.');
    const allowed = expectedEnums[pathKey] || expectedEnums[output.name];
    if (!allowed) continue;
    const invalidValues = (output.sampleValues || []).filter(value => !allowed.includes(value));
    checks.push({
      type: 'enum_values',
      field: output.name,
      path: [...(output.path || [])],
      allowed: [...allowed],
      sampleValues: [...(output.sampleValues || [])],
      invalidValues: [...invalidValues],
      passed: invalidValues.length === 0,
    });
  }
  return checks;
}

function semanticContradictionChecks(parentFullValues = []) {
  const linkedinNotFoundHighConfidence = parentFullValues.filter(value => {
    if (!value || typeof value !== 'object') return false;
    const linkedin = String(value.linkedin_url || value.linkedinUrl || '').toUpperCase();
    const confidence = String(value.confidence || '').toLowerCase();
    return linkedin === 'NOT_FOUND' && ['high', 'very_high'].includes(confidence);
  }).length;
  return [
    {
      type: 'semantic_contradictions',
      rule: 'linkedin_url NOT_FOUND must not have high confidence',
      violationCount: linkedinNotFoundHighConfidence,
      passed: linkedinNotFoundHighConfidence === 0,
    },
  ];
}

function isCompatibleUseAiModelPair({ model, useCase } = {}) {
  const modelText = String(model || '').replace(/^['"]|['"]$/g, '');
  const useCaseText = String(useCase || '').replace(/^['"]|['"]$/g, '');
  if (/^clay-/i.test(modelText) && useCaseText && useCaseText !== 'claygent') return false;
  return true;
}

function buildSafeModelMatrixProbePlan(opts = {}) {
  const model = opts.model || 'clay-argon';
  const useCase = opts.useCase || 'claygent';
  const tableId = opts.tableId;
  const viewId = opts.viewId;
  const fieldId = opts.fieldId || '<AI_FIELD_ID_AFTER_CREATE>';
  const rowLimit = Number(opts.rowLimit || 1);
  const watchTimeoutSeconds = Number(opts.watchTimeoutSeconds || 90);
  if (rowLimit !== 1) throw new Error('safe model matrix probe must start with exactly one row');
  if (watchTimeoutSeconds > 120) throw new Error('safe model matrix probe watch timeout must be <=120 seconds');
  if (!isCompatibleUseAiModelPair({ model, useCase })) throw new Error(`incompatible Use AI model/useCase pair: ${model} + ${useCase}`);
  const commands = [];
  if (tableId && viewId) {
    commands.push(`node clay-v2.js run-top ${tableId} --field ${fieldId} --view ${viewId} --n 1 --confirm`);
    commands.push(`node clay-v2.js run-watch ${tableId} --field ${fieldId} --timeout ${watchTimeoutSeconds}`);
    commands.push(`node clay-v2.js manifest ${tableId} --view ${viewId} --include-rows 1 --out runs/<date>/model-matrix-one-row-manifest.json`);
    commands.push(`node clay-v2.js proof-readback ${tableId} --view ${viewId} --field ${fieldId} --include-rows 1 --out runs/<date>/model-matrix-one-row-proof.json`);
  }
  return {
    kind: 'safe_model_matrix_probe_plan',
    model,
    useCase,
    rowLimit,
    watchTimeoutSeconds,
    compatibility: { compatible: true, rule: 'Clay-native models require useCase=claygent; never use clay-argon with useCase=use-ai.' },
    guardrails: [
      'Run exactly one model and one row before expanding.',
      'Do not chain multiple run-watch commands in one shell.',
      'Use a short watch timeout (<=120s; default 90s).',
      'Inspect parent externalContent.fullValue; extracted SUCCESS alone is failure-prone.',
      'Document results as compatibility observations, not universal model claims.',
    ],
    commands,
  };
}

function validateSafeModelMatrixProbeResult(proofOrPacket = {}) {
  const packet = proofOrPacket.packet || proofOrPacket;
  const issues = [];
  const rowLimit = Number(packet.rowLimit || packet.runReadback?.checkedRows || 0);
  if (rowLimit !== 1) issues.push({ severity: 'error', type: 'model_probe_not_one_row', actual: rowLimit });
  const parentRows = Number(packet.parentOutputInspection?.rowsWithFullValue || 0);
  if (parentRows < 1) issues.push({ severity: 'error', type: 'model_probe_missing_parent_full_value', message: 'Extracted output SUCCESS is insufficient without parent externalContent.fullValue.' });
  if (packet.configReadback?.settingsError) issues.push({ severity: 'error', type: 'model_probe_settings_error', settingsError: packet.configReadback.settingsError });
  const runtimeErrors = packet.runReadback?.unresolvedRuntimeErrors || [];
  if (runtimeErrors.length) issues.push({ severity: 'error', type: 'model_probe_runtime_errors', runtimeErrors });
  const outputs = packet.extractedOutputs || [];
  const extractedGreenButNoParent = parentRows < 1 && outputs.some(output => Object.keys(output.statusCounts || {}).some(status => status === 'SUCCESS'));
  if (extractedGreenButNoParent) issues.push({ severity: 'error', type: 'model_probe_extracted_success_without_parent_full_value' });
  return { valid: issues.every(issue => issue.severity !== 'error'), issueCount: issues.length, issues };
}

function buildProofPacketFromManifest(manifest, opts = {}) {
  const table = manifest.table || {};
  const records = (manifest.records || []).slice(0, Number(opts.rowLimit || 10));
  const fieldId = opts.fieldId;
  const field = (table.fields || []).find(item => item.id === fieldId || item.name === opts.fieldName);
  if (!field) throw new Error(`proof field not found: ${fieldId || opts.fieldName}`);
  const actionKey = opts.actionKey || field.typeSettings?.actionKey;
  const parentStatusCounts = statusCountsForField(records, field.id);
  const parentFullValues = records.map(record => getCellFullValue(record.cells?.[field.id])).filter(isNonEmptyValue);
  const sampleFullValue = parentFullValues[0] || null;
  const sampleFullValueKeys = topLevelKeys(sampleFullValue);
  const unresolvedRuntimeErrors = Object.keys(parentStatusCounts).filter(status => /^ERROR/.test(status));
  const extractedOutputs = summarizeExtractedOutputs(manifest, field.id, records);
  const extractedValuesVerified = extractedOutputs.length > 0 && extractedOutputs.some(output => output.nonEmptyCount > 0);
  const settingsError = field.typeSettings?.settingsError || field.settingsError || null;
  const rowLimit = Number(opts.rowLimit || records.length || 10);
  const strictProofRequirements = {
    realDataRows: records.length > 0,
    configReadbackClean: !settingsError,
    parentFullValueInspected: true,
    parentFullValuePresent: parentFullValues.length > 0,
    extractedOutputsCreated: extractedOutputs.length > 0,
    extractedValuesVerified,
    statusSemanticsDocumented: true,
    noUnresolvedProofPathErrors: !settingsError && unresolvedRuntimeErrors.length === 0,
  };
  const passed = Object.values(strictProofRequirements).every(Boolean);
  const invalidShapeOutputs = extractedOutputs.filter(output => output.invalidShapeCount > 0);
  const expectedEnums = opts.expectedEnums || {};
  const valueChecks = [
    { type: 'parent_full_value_present', passed: parentFullValues.length > 0, rowsWithFullValue: parentFullValues.length, checkedRows: records.length },
    { type: 'extracted_outputs_created', passed: extractedOutputs.length > 0, count: extractedOutputs.length },
    { type: 'extracted_values_non_empty', passed: extractedValuesVerified, outputs: extractedOutputs.map(output => ({ name: output.name, nonEmptyCount: output.nonEmptyCount, blankCount: output.blankCount })) },
    { type: 'extracted_value_shapes', passed: invalidShapeOutputs.length === 0, invalidShapeOutputs: invalidShapeOutputs.map(output => ({ name: output.name, expectedShape: output.expectedShape, invalidShapeCount: output.invalidShapeCount })) },
    { type: 'no_settings_error', passed: !settingsError, settingsError },
    { type: 'no_unresolved_runtime_errors', passed: unresolvedRuntimeErrors.length === 0, unresolvedRuntimeErrors: [...unresolvedRuntimeErrors] },
    ...enumValueQaChecks(extractedOutputs, expectedEnums),
    ...semanticContradictionChecks(parentFullValues),
  ];
  const packet = createProofPacket({
    actionKey,
    outcome: passed ? 'passed' : 'failed',
    scope: {
      workspaceId: String(table.workspaceId || opts.workspaceId || ''),
      workbookId: String(table.workbookId || opts.workbookId || ''),
      tableId: String(table.id || opts.tableId || ''),
      viewId: String(opts.viewId || table.firstViewId || ''),
    },
    field: {
      id: field.id,
      name: field.name,
      actionKey,
      type: field.type,
      inputFieldIds: field.inputFieldIds || [],
    },
    rowLimit,
    configReadback: {
      actionKey,
      actionPackageId: field.typeSettings?.actionPackageId,
      actionVersion: field.typeSettings?.actionVersion,
      inputsBinding: field.typeSettings?.inputsBinding || [],
      runCondition: field.typeSettings?.conditionalRunFormulaText || null,
      settingsError,
    },
    runReadback: {
      checkedRows: records.length,
      statusCounts: parentStatusCounts,
      unresolvedRuntimeErrors,
    },
    parentOutputInspection: {
      inspectedRows: records.length,
      rowsWithFullValue: parentFullValues.length,
      sampleFullValueKeys,
      sampleFullValue,
    },
    extractedOutputs,
    valueQa: { passed: valueChecks.every(check => check.passed), checks: valueChecks },
    statusSemantics: { documented: true, notes: [`Parent statuses: ${JSON.stringify(parentStatusCounts)}`] },
    strictProofRequirements,
    failureModes: valueChecks.filter(check => !check.passed).map(check => check.type),
    artifacts: opts.artifacts || [],
  });
  return { packet, validation: validateProofPacket(packet) };
}

module.exports = {
  getCellStatus,
  getCellFullValue,
  isNonEmptyValue,
  topLevelKeys,
  flattenObjectPaths,
  suggestExtractedOutputPaths,
  expectedShapeForOutput,
  valueMatchesShape,
  enumValueQaChecks,
  semanticContradictionChecks,
  isCompatibleUseAiModelPair,
  buildSafeModelMatrixProbePlan,
  validateSafeModelMatrixProbeResult,
  findExtractedOutputFields,
  summarizeExtractedOutputs,
  buildProofPacketFromManifest,
};

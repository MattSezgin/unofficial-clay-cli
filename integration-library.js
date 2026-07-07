const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, 'integration-library', 'registry.yaml');
const PROMOTION_STATUSES = new Set(['discovered', 'reviewed', 'battle-tested']);
const PROOF_STATUSES = new Set([
  'not_started',
  'needs_fresh_value_level_proof',
  'in_progress',
  'real_data_output_verified',
  'failed_settings_error',
  'failed_runtime_error',
  'failed_no_parent_full_value',
  'failed_blank_or_unverified_values',
  'blocked_requires_auth',
  'blocked_destructive_external_mutation',
  'blocked_paid_or_unbounded_cost',
  'blocked_missing_safe_test_data',
  'blocked_external_dependency',
]);
const BLOCKED_PROOF_STATUSES = new Set([...PROOF_STATUSES].filter(status => status.startsWith('blocked_')));
const STRICT_PROOF_REQUIREMENT_KEYS = [
  'sourceExportEvidence',
  'requiredOptionalInputsCurated',
  'sandboxRealDataRun',
  'parentFullValueInspected',
  'extractedOutputsCreated',
  'extractedValuesVerified',
  'statusSemanticsDocumented',
  'unresolvedProofPathErrors',
];

function normalizePromotionStatus(integration = {}) {
  if (PROMOTION_STATUSES.has(integration.promotionStatus)) return integration.promotionStatus;
  if (PROMOTION_STATUSES.has(integration.status)) return integration.status;
  if (typeof integration.status === 'string' && integration.status.includes('battle')) return 'battle-tested';
  if (typeof integration.status === 'string' && integration.status.includes('review')) return 'reviewed';
  return 'discovered';
}

function loadIntegrationRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const text = fs.readFileSync(registryPath, 'utf8');
  const registry = YAML.parse(text);
  if (!registry || typeof registry !== 'object') throw new Error(`invalid integration registry: ${registryPath}`);
  if (!registry.integrations || typeof registry.integrations !== 'object') throw new Error(`integration registry missing integrations: ${registryPath}`);
  return registry;
}

function normalizeProofStatus(integration = {}) {
  if (PROOF_STATUSES.has(integration.proofStatus)) return integration.proofStatus;
  if (normalizePromotionStatus(integration) === 'battle-tested') return 'real_data_output_verified';
  return integration.proofStatus || 'not_started';
}

function withNormalizedIntegration(key, integration) {
  return { key, ...integration, promotionStatus: normalizePromotionStatus(integration), proofStatus: normalizeProofStatus(integration) };
}

function isBlockedIntegration(integration = {}) {
  return BLOCKED_PROOF_STATUSES.has(normalizeProofStatus(integration));
}

function proofRequirementIssues(integration = {}) {
  const issues = [];
  const proofStatus = normalizeProofStatus(integration);
  const promotionStatus = normalizePromotionStatus(integration);
  if (!PROOF_STATUSES.has(proofStatus)) issues.push({ severity: 'error', type: 'invalid_proof_status', proofStatus });
  const req = integration.proofRequirements || {};
  if (!req || typeof req !== 'object' || Array.isArray(req)) issues.push({ severity: 'error', type: 'invalid_proof_requirements' });
  for (const key of STRICT_PROOF_REQUIREMENT_KEYS) {
    if (!(key in req)) issues.push({ severity: 'warning', type: 'missing_proof_requirement_key', key });
  }
  if (promotionStatus === 'battle-tested') {
    const proof = strictProofStatus({ ...integration, proofStatus });
    if (!proof.strictBattleTested) issues.push({ severity: 'error', type: 'battle_tested_without_strict_proof', missingProofRequirements: proof.missingProofRequirements });
  }
  if (isBlockedIntegration({ ...integration, proofStatus }) && !integration.blockedReason) {
    issues.push({ severity: 'error', type: 'blocked_without_reason', proofStatus });
  }
  return issues;
}

function validateRegistryProofStates(registry = loadIntegrationRegistry()) {
  const issues = [];
  for (const [key, integration] of Object.entries(registry.integrations || {})) {
    for (const issue of proofRequirementIssues(integration)) issues.push({ actionKey: key, ...issue });
  }
  return { valid: issues.every(issue => issue.severity !== 'error'), issueCount: issues.length, issues };
}

function listIntegrations(registry = loadIntegrationRegistry()) {
  return Object.entries(registry.integrations).map(([key, value]) => withNormalizedIntegration(key, value)).sort((a, b) => a.key.localeCompare(b.key));
}

function getIntegration(actionKey, registry = loadIntegrationRegistry()) {
  const integration = registry.integrations[actionKey];
  if (!integration) throw new Error(`unknown Clay integration/actionKey: ${actionKey}`);
  return withNormalizedIntegration(actionKey, integration);
}

function normalizeInputNames(fieldSpec = {}) {
  return Object.keys(fieldSpec.inputs || {}).sort();
}

function validateActionFieldAgainstRegistry(fieldSpec, registry = loadIntegrationRegistry()) {
  const issues = [];
  if (!fieldSpec || typeof fieldSpec !== 'object') return [{ severity: 'error', type: 'invalid_field_spec', message: 'field spec must be an object' }];
  const actionKey = fieldSpec.actionKey;
  if (!actionKey) return [{ severity: 'error', type: 'missing_action_key', message: 'action field missing actionKey' }];
  let integration;
  try { integration = getIntegration(actionKey, registry); } catch (err) {
    return [{ severity: 'warning', type: 'unknown_integration', actionKey, message: err.message }];
  }
  const packageIds = integration.actionPackageIds || [];
  if (fieldSpec.actionPackageId && packageIds.length && !packageIds.includes(fieldSpec.actionPackageId)) {
    issues.push({ severity: 'error', type: 'unexpected_action_package_id', actionKey, expected: packageIds, actual: fieldSpec.actionPackageId });
  }
  const versions = integration.actionVersions || [];
  if (fieldSpec.actionVersion && versions.length && !versions.includes(fieldSpec.actionVersion)) {
    issues.push({ severity: 'warning', type: 'unexpected_action_version', actionKey, expected: versions, actual: fieldSpec.actionVersion });
  }
  const provided = new Set(normalizeInputNames(fieldSpec));
  if (fieldSpec.actionKey === 'use-ai' && Array.isArray(fieldSpec.outputs) && fieldSpec.outputs.length) provided.add('answerSchemaType');
  const required = integration.requiredInputs || [];
  const missingRequired = required.filter(name => !provided.has(name));
  if (missingRequired.length) {
    issues.push({ severity: 'error', type: 'missing_required_inputs', actionKey, missing: missingRequired, message: 'Spec omits inputs curated as required for this integration.' });
  }
  if (fieldSpec.strictIntegrationCoverage) {
    const proof = strictProofStatus(integration);
    if (!proof.strictBattleTested) {
      issues.push({
        severity: 'warning',
        type: 'integration_not_strictly_battle_tested',
        actionKey,
        promotionStatus: integration.promotionStatus,
        proofStatus: integration.proofStatus || 'not_started',
        missingProofRequirements: proof.missingProofRequirements,
        message: 'Integration has not passed strict real-data output proof in the sandbox. Do not treat as tested until parent fullValue and extracted values are inspected with no unresolved proof-path errors.',
      });
    }
  }
  const observed = integration.requiredInputsObserved || [];
  const missingObserved = observed.filter(name => !provided.has(name));
  if (missingObserved.length && fieldSpec.strictIntegrationCoverage) {
    issues.push({ severity: 'warning', type: 'missing_observed_inputs', actionKey, missing: missingObserved, message: 'Spec omits inputs observed in real workbook exports. This is informational unless doing full source-workbook parity.' });
  }
  if (integration.authRequiredObserved && !fieldSpec.authAccountId && !fieldSpec.authProfile && !fieldSpec.authEnv) {
    issues.push({ severity: 'warning', type: 'auth_observed_but_not_configured', actionKey, message: 'Real exports showed auth for this integration. Provide authAccountId/authProfile/authEnv before live run.' });
  }
  if (integration.runConditionObserved && !fieldSpec.runCondition) {
    issues.push({ severity: 'warning', type: 'run_condition_observed_but_missing', actionKey, message: 'Real exports used run conditions for this integration; add one before credit-bearing runs.' });
  }
  return issues;
}

function validateSpecAgainstIntegrationRegistry(spec, registry = loadIntegrationRegistry()) {
  const fields = spec?.fields || [];
  const issues = [];
  for (const field of fields) {
    if (field?.actionKey || field?.type === 'action') {
      for (const issue of validateActionFieldAgainstRegistry(field, registry)) issues.push({ fieldName: field.name || null, ...issue });
    }
  }
  return { valid: issues.every(issue => issue.severity !== 'error'), issueCount: issues.length, issues };
}

function strictProofStatus(integration = {}) {
  const req = integration.proofRequirements || {};
  const requiredTrue = STRICT_PROOF_REQUIREMENT_KEYS.filter(key => key !== 'unresolvedProofPathErrors');
  const missing = requiredTrue.filter(key => req[key] !== true);
  if (req.unresolvedProofPathErrors !== false) missing.push('unresolvedProofPathErrors_must_be_false');
  const strictBattleTested = missing.length === 0 && normalizePromotionStatus(integration) === 'battle-tested' && normalizeProofStatus(integration) === 'real_data_output_verified';
  return { strictBattleTested, missingProofRequirements: missing, blocked: isBlockedIntegration(integration) };
}

function integrationPromotionReport(registry = loadIntegrationRegistry()) {
  const integrations = listIntegrations(registry).map(item => ({ ...item, ...strictProofStatus(item) }));
  const byStatus = { discovered: [], reviewed: [], 'battle-tested': [] };
  const blocked = [];
  for (const integration of integrations) {
    byStatus[integration.promotionStatus].push(integration);
    if (integration.blocked) blocked.push(integration);
  }
  const needsProof = integrations
    .filter(item => !item.strictBattleTested)
    .map(item => ({
      actionKey: item.actionKey || item.key,
      promotionStatus: item.promotionStatus,
      proofStatus: item.proofStatus || 'not_started',
      observedCount: (item.observedIn || []).length,
      authRequiredObserved: !!item.authRequiredObserved,
      runConditionObserved: !!item.runConditionObserved,
      extractedOutputCount: (item.extractedOutputsObserved || []).length,
      missingProofRequirements: item.missingProofRequirements,
    }))
    .sort((a, b) => b.observedCount - a.observedCount || b.extractedOutputCount - a.extractedOutputCount || a.actionKey.localeCompare(b.actionKey));
  const nextProofTargets = needsProof
    .filter(item => item.authRequiredObserved || item.runConditionObserved || item.extractedOutputCount)
    .slice(0, 20);
  const proofStatusCounts = integrations.reduce((acc, item) => {
    const status = item.proofStatus || 'not_started';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  return {
    count: integrations.length,
    statusCounts: Object.fromEntries(Object.entries(byStatus).map(([status, items]) => [status, items.length])),
    proofStatusCounts,
    strictBattleTestedCount: integrations.filter(item => item.strictBattleTested).length,
    blockedCount: blocked.length,
    ambiguousCount: integrations.filter(item => !item.strictBattleTested && !item.blocked).length,
    battleTested: integrations.filter(item => item.strictBattleTested).map(item => item.actionKey || item.key).sort(),
    blocked: blocked.map(item => ({ actionKey: item.actionKey || item.key, proofStatus: item.proofStatus, blockedReason: item.blockedReason || null })).sort((a, b) => a.actionKey.localeCompare(b.actionKey)),
    reviewed: byStatus.reviewed.map(item => item.actionKey || item.key).sort(),
    discovered: byStatus.discovered.map(item => item.actionKey || item.key).sort(),
    needsProof,
    nextProofTargets,
  };
}

function integrationPromotionMarkdown(report = integrationPromotionReport()) {
  const lines = [];
  lines.push('# Clay Integration Promotion Report');
  lines.push('');
  lines.push(`- Registry integrations: ${report.count}`);
  lines.push(`- Strict battle-tested: ${report.strictBattleTestedCount}`);
  lines.push(`- Blocked: ${report.blockedCount}`);
  lines.push(`- Ambiguous / needs proof: ${report.ambiguousCount}`);
  lines.push(`- Raw promotion statuses: ${JSON.stringify(report.statusCounts)}`);
  lines.push(`- Proof statuses: ${JSON.stringify(report.proofStatusCounts)}`);
  lines.push('');
  lines.push('## Strict battle-tested');
  lines.push('');
  if (report.battleTested.length) for (const key of report.battleTested) lines.push(`- \`${key}\``);
  else lines.push('- None');
  lines.push('');
  lines.push('## Blocked');
  lines.push('');
  if (report.blocked.length) for (const item of report.blocked) lines.push(`- \`${item.actionKey}\` — ${item.proofStatus}: ${item.blockedReason || 'reason missing'}`);
  else lines.push('- None');
  lines.push('');
  lines.push('## Next proof targets');
  lines.push('');
  if (report.nextProofTargets.length) {
    for (const item of report.nextProofTargets) {
      lines.push(`- \`${item.actionKey}\` — ${item.promotionStatus}/${item.proofStatus}; missing: ${item.missingProofRequirements.join(', ')}`);
    }
  } else lines.push('- None');
  lines.push('');
  lines.push('## Needs proof');
  lines.push('');
  lines.push('| Action | Promotion | Proof status | Observed | Missing |');
  lines.push('|---|---|---|---:|---|');
  for (const item of report.needsProof) {
    lines.push(`| \`${item.actionKey}\` | \`${item.promotionStatus}\` | \`${item.proofStatus}\` | ${item.observedCount} | ${item.missingProofRequirements.join(', ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  PROMOTION_STATUSES,
  PROOF_STATUSES,
  BLOCKED_PROOF_STATUSES,
  STRICT_PROOF_REQUIREMENT_KEYS,
  normalizePromotionStatus,
  normalizeProofStatus,
  isBlockedIntegration,
  loadIntegrationRegistry,
  listIntegrations,
  getIntegration,
  validateActionFieldAgainstRegistry,
  validateSpecAgainstIntegrationRegistry,
  validateRegistryProofStates,
  integrationPromotionReport,
  integrationPromotionMarkdown,
};

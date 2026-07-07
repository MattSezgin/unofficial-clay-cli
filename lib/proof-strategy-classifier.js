#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const STRATEGIES = {
  sandbox_external_write: {
    strategy: 'sandbox_external_write',
    rowLimit: 1,
    mode: 'sandbox',
    hitlRequired: true,
    strictProofRule: 'External writes must only be attempted against a sandbox/test account after explicit HITL approval.',
  },
  sandbox_internal_write: {
    strategy: 'sandbox_internal_write',
    rowLimit: 1,
    mode: 'sandbox',
    hitlRequired: true,
    strictProofRule: 'Clay/table writes require an isolated scratch table and explicit HITL approval.',
  },
  one_row_enrichment: {
    strategy: 'one_row_enrichment',
    rowLimit: 1,
    mode: 'live_candidate',
    hitlRequired: true,
    strictProofRule: 'Credit-consuming or auth-backed enrichments are at most one row and require HITL before any live proof run.',
  },
  ten_row_safe_read: {
    strategy: 'ten_row_safe_read',
    rowLimit: 10,
    mode: 'live_candidate',
    hitlRequired: false,
    strictProofRule: 'Safe reads may be proven on up to ten rows when inputs are non-sensitive and no write side effect is possible.',
  },
  ten_row_source_preview: {
    strategy: 'ten_row_source_preview',
    rowLimit: 10,
    mode: 'live_candidate',
    hitlRequired: true,
    strictProofRule: 'Source/import-shaped reads must use preview or hard result caps and require HITL because they can create many rows.',
  },
  offline_validate_auth: {
    strategy: 'offline_validate_auth',
    rowLimit: 0,
    mode: 'offline_only',
    hitlRequired: true,
    strictProofRule: 'Auth validation is covered by catalog/offline contract checks unless a human explicitly approves credential validation.',
  },
  review_block_unknown: {
    strategy: 'review_block_unknown',
    rowLimit: 0,
    mode: 'offline_review_blocked',
    hitlRequired: true,
    strictProofRule: 'Unknown safety never maps to live execution; review and classify before proof.',
  },
};

const EXTERNAL_WRITE_RE = /\b(add|append|assign|attach|create|delete|draft|export|insert|invite|merge|post|publish|push|reply|remove|send|sync|trigger|update|upsert|write)\b/i;
const SAFE_READ_RE = /\b(analyze|check|compare|domain|enrich|extract|find|get|lookup|normalize|parse|predict|read|scrape|search|validate|verify)\b/i;
const SOURCE_RE = /(?:^|[-_\s])(source|import|pull|find-lists?|search)(?:$|[-_\s])/i;
const AUTH_RE = /(?:^|[-_\s])validate-auth(?:$|[-_\s])|validate auth/i;

const INTERNAL_PACKAGES = new Set(['clay', 'Clay', 'ClayPackage']);

function normalizeText(action) {
  return [
    action.key,
    action.displayName,
    action.description,
    action.actionLabels && action.actionLabels.type,
    ...(action.categories || []),
    ...(action.package && action.package.categories ? action.package.categories : []),
  ].filter(Boolean).join(' ');
}

function isRedacted(value) {
  return typeof value === 'string' && /<redacted:[a-f0-9]+>/i.test(value);
}

function isSourceAction(action, text) {
  return SOURCE_RE.test(action.key || '') || SOURCE_RE.test(action.displayName || '') || SOURCE_RE.test(text) || Boolean(action.isSource);
}

function isExternalPackage(action) {
  const packageKey = action.package && action.package.key;
  const provider = action.auth && action.auth.providerType;
  if (!packageKey && !provider) return false;
  if (INTERNAL_PACKAGES.has(packageKey) || INTERNAL_PACKAGES.has(provider)) return false;
  return true;
}

function isCreditOrEnrichment(action, text) {
  if (action.pricing && action.pricing.credits) return true;
  if (/\b(enrich|email|phone|waterfall|people data|company data|enrichment_tool|Enrich Data)\b/i.test(text)) return true;
  return false;
}

function classifySafety(action) {
  const text = normalizeText(action);
  if (!action || !action.key || isRedacted(action.key)) return { safetyClass: 'unknown', reasons: ['missing_or_redacted_key'] };
  if (AUTH_RE.test(action.key) || AUTH_RE.test(action.displayName || '')) return { safetyClass: 'auth_validation', reasons: ['validate_auth_shape'] };

  const source = isSourceAction(action, text);
  const external = isExternalPackage(action);
  const hasWriteVerb = EXTERNAL_WRITE_RE.test(action.key) || EXTERNAL_WRITE_RE.test(action.displayName || '') || /\b(Send Data|Add Data|Export)\b/i.test(text);
  const safeRead = SAFE_READ_RE.test(action.key) || SAFE_READ_RE.test(action.displayName || '') || /\b(read|lookup|search|preview)\b/i.test(text);

  if (hasWriteVerb && external) return { safetyClass: 'external_write', reasons: ['write_shape', 'external_package_or_auth'] };
  if (hasWriteVerb) return { safetyClass: 'internal_write', reasons: ['write_shape'] };
  if (source) return { safetyClass: 'source_read', reasons: ['source_or_import_shape'] };
  if (isCreditOrEnrichment(action, text)) return { safetyClass: 'safe_enrichment', reasons: ['enrichment_or_credit_shape'] };
  if (safeRead) return { safetyClass: 'safe_read', reasons: ['read_shape'] };
  return { safetyClass: 'unknown', reasons: ['no_strict_rule_matched'] };
}

function strategyForSafety(safetyClass) {
  switch (safetyClass) {
    case 'external_write': return STRATEGIES.sandbox_external_write;
    case 'internal_write': return STRATEGIES.sandbox_internal_write;
    case 'source_read': return STRATEGIES.ten_row_source_preview;
    case 'safe_enrichment': return STRATEGIES.one_row_enrichment;
    case 'safe_read': return STRATEGIES.ten_row_safe_read;
    case 'auth_validation': return STRATEGIES.offline_validate_auth;
    default: return STRATEGIES.review_block_unknown;
  }
}

function normalizeCatalog(raw) {
  const actions = raw && raw.actions ? raw.actions : raw;
  if (Array.isArray(actions)) return actions;
  if (actions && typeof actions === 'object') return Object.values(actions);
  throw new Error('catalog must be an array or an object with actions');
}

function assignProofStrategy(action) {
  const safety = classifySafety(action || {});
  const strategy = strategyForSafety(safety.safetyClass);
  return {
    key: action && action.key,
    packageKey: action && action.package && action.package.key,
    packageType: action && action.package && action.package.categories ? action.package.categories.join(',') : null,
    actionShape: isSourceAction(action || {}, normalizeText(action || {})) ? 'source' : 'action',
    safetyClass: safety.safetyClass,
    proofStrategy: { ...strategy },
    reasons: safety.reasons,
  };
}

function assignCatalogProofStrategies(raw) {
  const actions = normalizeCatalog(raw);
  const byKey = {};
  const duplicateKeys = [];
  const summary = { totalActions: actions.length, uniqueKeys: 0, strategyCounts: {}, safetyClassCounts: {}, duplicateKeyCount: 0 };

  for (const action of actions) {
    const assigned = assignProofStrategy(action);
    const key = assigned.key || '<missing-key>';
    if (byKey[key]) duplicateKeys.push(key);
    byKey[key] = assigned;
    summary.strategyCounts[assigned.proofStrategy.strategy] = (summary.strategyCounts[assigned.proofStrategy.strategy] || 0) + 1;
    summary.safetyClassCounts[assigned.safetyClass] = (summary.safetyClassCounts[assigned.safetyClass] || 0) + 1;
  }

  summary.uniqueKeys = Object.keys(byKey).length;
  summary.duplicateKeyCount = duplicateKeys.length;
  return { generatedAt: new Date(0).toISOString(), summary, duplicateKeys, strategies: byKey };
}

function main(argv) {
  const input = argv[2];
  const output = argv[3];
  if (!input) {
    console.error(`Usage: ${path.basename(argv[1])} <catalog.json> [output.json]`);
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
  const assigned = assignCatalogProofStrategies(raw);
  const body = `${JSON.stringify(assigned, null, 2)}\n`;
  if (output) fs.writeFileSync(output, body);
  else process.stdout.write(body);
}

if (require.main === module) main(process.argv);

module.exports = {
  STRATEGIES,
  classifySafety,
  assignProofStrategy,
  assignCatalogProofStrategies,
};

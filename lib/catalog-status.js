'use strict';

const CATALOG_STATUSES = Object.freeze([
  'cataloged',
  'classified',
  'template_ready',
  'proof_queued',
  'strict_battle_tested',
  'blocked',
  'excluded',
]);

const STRICT_PROOF_REQUIRED_FIELDS = Object.freeze([
  'evidenceBundleId',
  'testedAt',
  'tester',
  'result',
]);

const VALID_TRANSITIONS = Object.freeze({
  cataloged: Object.freeze(['classified', 'blocked', 'excluded']),
  classified: Object.freeze(['template_ready', 'proof_queued', 'blocked', 'excluded']),
  template_ready: Object.freeze(['proof_queued', 'blocked', 'excluded']),
  proof_queued: Object.freeze(['strict_battle_tested', 'blocked', 'excluded']),
  strict_battle_tested: Object.freeze(['blocked', 'excluded']),
  blocked: Object.freeze(['cataloged', 'classified', 'template_ready', 'proof_queued', 'excluded']),
  excluded: Object.freeze([]),
});

function assertKnownStatus(status, label = 'status') {
  if (!CATALOG_STATUSES.includes(status)) {
    throw new Error(`Unknown catalog ${label}: ${status}`);
  }
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateStrictProofMetadata(metadata = {}) {
  const proof = metadata.strictProof;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    throw new Error('strict_battle_tested requires strictProof metadata');
  }

  const missing = STRICT_PROOF_REQUIRED_FIELDS.filter(field => !hasText(proof[field]));
  if (missing.length > 0) {
    throw new Error(`strict_battle_tested requires strictProof metadata fields: ${missing.join(', ')}`);
  }

  if (proof.result !== 'passed') {
    throw new Error('strict_battle_tested requires strictProof.result to be passed');
  }
}

function validateBlockedMetadata(metadata = {}) {
  if (!hasText(metadata.blockedReason)) {
    throw new Error('blocked status requires blockedReason');
  }
  if (!hasText(metadata.unblockInstructions)) {
    throw new Error('blocked status requires unblockInstructions');
  }
}

function validateCatalogStatusTransition(fromStatus, toStatus, metadata = {}) {
  assertKnownStatus(fromStatus, 'fromStatus');
  assertKnownStatus(toStatus, 'toStatus');

  if (fromStatus !== toStatus) {
    const allowed = VALID_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      throw new Error(`Invalid catalog status transition: ${fromStatus} -> ${toStatus}`);
    }
  }

  if (toStatus === 'strict_battle_tested') {
    validateStrictProofMetadata(metadata);
  }

  if (toStatus === 'blocked') {
    validateBlockedMetadata(metadata);
  }

  return true;
}

function transitionCatalogStatus(entry, toStatus, metadata = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('transitionCatalogStatus requires an entry object');
  }

  const fromStatus = entry.catalogStatus || 'cataloged';
  validateCatalogStatusTransition(fromStatus, toStatus, metadata);

  return {
    ...entry,
    catalogStatus: toStatus,
    catalogStatusUpdatedAt: metadata.updatedAt || new Date().toISOString(),
    catalogStatusReason: metadata.reason || entry.catalogStatusReason,
    strictProof: metadata.strictProof || entry.strictProof,
    blockedReason: metadata.blockedReason || (toStatus === 'blocked' ? entry.blockedReason : undefined),
    unblockInstructions: metadata.unblockInstructions || (toStatus === 'blocked' ? entry.unblockInstructions : undefined),
  };
}

function deriveStrictRegistryStatus(entry) {
  return entry?.catalogStatus === 'strict_battle_tested' && entry?.strictProof?.result === 'passed'
    ? 'strict_battle_tested'
    : 'not_strict_battle_tested';
}

module.exports = {
  CATALOG_STATUSES,
  VALID_TRANSITIONS,
  validateCatalogStatusTransition,
  transitionCatalogStatus,
  deriveStrictRegistryStatus,
};

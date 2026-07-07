'use strict';

const assert = require('assert');
const {
  CATALOG_STATUSES,
  validateCatalogStatusTransition,
  transitionCatalogStatus,
  deriveStrictRegistryStatus,
} = require('../lib/catalog-status');

assert.deepStrictEqual(CATALOG_STATUSES, [
  'cataloged',
  'classified',
  'template_ready',
  'proof_queued',
  'strict_battle_tested',
  'blocked',
  'excluded',
]);

const strictProof = {
  evidenceBundleId: 'evidence_local_001',
  testedAt: '2026-06-09T00:00:00.000Z',
  tester: 'offline-test',
  result: 'passed',
};

assert.strictEqual(validateCatalogStatusTransition('cataloged', 'classified'), true);
assert.strictEqual(validateCatalogStatusTransition('classified', 'template_ready'), true);
assert.strictEqual(validateCatalogStatusTransition('template_ready', 'proof_queued'), true);
assert.strictEqual(
  validateCatalogStatusTransition('proof_queued', 'strict_battle_tested', { strictProof }),
  true,
);
assert.strictEqual(
  validateCatalogStatusTransition('classified', 'blocked', {
    blockedReason: 'provider schema changed',
    unblockInstructions: 'refresh normalized fixture and reclassify',
  }),
  true,
);
assert.strictEqual(validateCatalogStatusTransition('cataloged', 'excluded'), true);

assert.throws(
  () => validateCatalogStatusTransition('cataloged', 'template_ready'),
  /Invalid catalog status transition: cataloged -> template_ready/,
);
assert.throws(
  () => validateCatalogStatusTransition('cataloged', 'missing'),
  /Unknown catalog toStatus: missing/,
);
assert.throws(
  () => validateCatalogStatusTransition('proof_queued', 'strict_battle_tested'),
  /strict_battle_tested requires strictProof metadata/,
);
assert.throws(
  () => validateCatalogStatusTransition('proof_queued', 'strict_battle_tested', {
    strictProof: { ...strictProof, result: 'simulated' },
  }),
  /strictProof.result to be passed/,
);
assert.throws(
  () => validateCatalogStatusTransition('classified', 'blocked', { blockedReason: 'missing auth fixture' }),
  /blocked status requires unblockInstructions/,
);
assert.throws(
  () => validateCatalogStatusTransition('excluded', 'cataloged'),
  /Invalid catalog status transition: excluded -> cataloged/,
);

const action = { actionKey: 'find-people', catalogStatus: 'proof_queued' };
const promoted = transitionCatalogStatus(action, 'strict_battle_tested', {
  strictProof,
  updatedAt: '2026-06-09T00:00:00.000Z',
});
assert.strictEqual(promoted.catalogStatus, 'strict_battle_tested');
assert.strictEqual(promoted.strictProof.evidenceBundleId, strictProof.evidenceBundleId);
assert.strictEqual(deriveStrictRegistryStatus(promoted), 'strict_battle_tested');
assert.strictEqual(deriveStrictRegistryStatus({ catalogStatus: 'template_ready' }), 'not_strict_battle_tested');

console.log('catalog status transition tests passed');

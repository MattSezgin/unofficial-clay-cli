'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDashboard, renderMarkdown, DEFAULT_RAW } = require('./catalog-coverage-dashboard');

// Hermetic smoke test against a small synthetic catalog - does not depend on
// any private/local raw catalog dump.
const fixtureActions = [
  { key: 'find-company-domain', displayName: 'Find Company Domain', package: { key: 'ClayPackage', displayName: 'Clay' } },
  { key: 'hubspot-create-contact', displayName: 'Create Contact', package: { key: 'HubSpotPackage', displayName: 'HubSpot' } },
];
const fixtureRawPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-coverage-')), 'fixture-catalog.raw.json');
fs.writeFileSync(fixtureRawPath, JSON.stringify({ actions: fixtureActions }, null, 2));

const smokeDashboard = buildDashboard({ raw: fixtureRawPath, limit: 10 });
assert.strictEqual(smokeDashboard.catalogCoverage.definitionCount, 2);
assert.strictEqual(smokeDashboard.catalogCoverage.uniqueKeyCount, 2);
assert.ok(typeof smokeDashboard.catalogCoverage.packageCount === 'number');
assert.match(renderMarkdown(smokeDashboard), /Catalog coverage \(not strict proof\)/);
assert.match(renderMarkdown(smokeDashboard), /Strict proof coverage \(separate tier\)/);
fs.unlinkSync(fixtureRawPath);

// Exact baseline assertions only run when a real/local raw catalog dump is
// present (private artifact under ignored runs/, not part of the public repo).
if (fs.existsSync(DEFAULT_RAW)) {
  const dashboard = buildDashboard({ limit: 10 });

  assert.strictEqual(dashboard.catalogCoverage.definitionCount, 1282, 'definition baseline changed');
  assert.strictEqual(dashboard.catalogCoverage.uniqueKeyCount, 1244, 'unique action key baseline changed');
  assert.strictEqual(dashboard.catalogCoverage.packageCount, 269, 'package/app/provider baseline changed');
  assert.deepStrictEqual(dashboard.catalogCoverage.catalogStatuses, {
    blocked: 352,
    proof_queued: 892,
  });
  assert.deepStrictEqual(dashboard.catalogCoverage.safetyDistribution, {
    bulk_or_scale_sensitive: 112,
    clay_internal_write: 35,
    destructive_external_mutation: 9,
    external_write_mutation: 102,
    purchase_or_unbounded_cost: 104,
    requires_provider_auth: 368,
    safe_auth_check: 119,
    safe_read_enrichment: 224,
    safe_source_preview: 146,
    unknown_requires_review: 25,
  });
  assert.deepStrictEqual(dashboard.catalogCoverage.proofStrategyDistribution, {
    blocked_missing_safe_test_data: 25,
    controlled_lookup_fixture: 35,
    external_sandbox_required: 102,
    hitl_destructive_required: 9,
    hitl_paid_scope_required: 216,
    one_row_live_readback: 224,
    provider_auth_probe_then_live: 487,
    source_preview_only: 146,
  });
  assert.strictEqual(dashboard.strictProofCoverage.registryActionCount, 40, 'strict registry baseline changed');
  assert.deepStrictEqual(dashboard.strictProofCoverage.strictStatuses, {
    blocked_destructive_external_mutation: 2,
    blocked_external_dependency: 3,
    blocked_missing_safe_test_data: 8,
    blocked_paid_or_unbounded_cost: 1,
    blocked_requires_auth: 1,
    real_data_output_verified: 25,
  });
  assert.ok(dashboard.nextProofTargets.length > 0, 'expected next proof targets');
  assert.ok(dashboard.topBlockedPackages.length > 0, 'expected top blocked packages');
  assert.match(renderMarkdown(dashboard), /Catalog coverage \(not strict proof\)/);
  assert.match(renderMarkdown(dashboard), /Strict proof coverage \(separate tier\)/);
}

console.log('catalog coverage dashboard tests passed');

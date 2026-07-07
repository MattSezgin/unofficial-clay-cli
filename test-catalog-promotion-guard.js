#!/usr/bin/env node

const assert = require('assert');
const {
  buildPromotionProposal,
  promoteCatalogKey,
  proofFailures,
} = require('./catalog-promotion-guard');

const catalog = {
  count: 2,
  actions: [
    {
      key: 'apollo-enrich-person',
      version: 3,
      package: { id: 'pkg-apollo', key: 'ApolloPackage' },
      displayName: 'Apollo Enrich Person',
    },
    {
      key: 'http-api-v2',
      version: 1,
      package: { id: 'pkg-http', key: 'HttpApiPackage' },
      displayName: 'HTTP API',
    },
  ],
};

const existingEntries = Array.from({ length: 38 }, (_, i) => ({
  key: `existing-${String(i + 1).padStart(2, '0')}`,
  status: 'battle-tested',
}));
const registry = { entries: existingEntries };

const strictProof = {
  parentFullValue: { response: { email: 'a@example.com' } },
  extractedOutputs: [
    { name: 'email', path: 'response.email', value: 'a@example.com' },
  ],
  valueQa: { status: 'pass', checkedRows: 3 },
  statusSemantics: { success: 'email returned', noData: 'not found', error: 'provider/runtime error' },
  runtimeErrors: [],
  settingsErrors: [],
};

assert.deepStrictEqual(proofFailures(strictProof), [], 'strict proof should satisfy promotion guard');

const proposal = buildPromotionProposal({ catalog, registry, key: 'apollo-enrich-person', proof: strictProof });
assert.strictEqual(proposal.ok, true, 'catalog key with strict proof should be proposed');
assert.strictEqual(proposal.alreadyRegistered, false);
assert.strictEqual(proposal.catalogEntry.packageId, 'pkg-apollo');

const promoted = promoteCatalogKey({ catalog, registry, key: 'apollo-enrich-person', proof: strictProof });
assert.strictEqual(promoted.promoted, true);
assert.strictEqual(promoted.registry.entries.length, 39, 'promotion should append one registry entry');
for (const entry of existingEntries) {
  assert(promoted.registry.entries.some(next => next.key === entry.key), `existing registry entry lost: ${entry.key}`);
}
assert(promoted.registry.entries.some(entry => entry.key === 'apollo-enrich-person' && entry.status === 'battle-tested'));

const templateOnly = {
  status: 'template-only',
  extractedOutputs: [{ name: 'email', path: 'response.email' }],
  statusSemantics: { success: 'template says success' },
  valueQa: { status: 'pass' },
};
const templateProposal = buildPromotionProposal({ catalog, registry, key: 'http-api-v2', proof: templateOnly });
assert.strictEqual(templateProposal.ok, false, 'template-only/catalog state must not promote');
assert(templateProposal.failures.includes('parent_fullValue_required'));
assert(templateProposal.failures.includes('catalog_or_template_only_state_is_not_strict_proof'));
assert.throws(
  () => promoteCatalogKey({ catalog, registry, key: 'http-api-v2', proof: templateOnly }),
  /promotion rejected/,
  'attempted promotion without strict battle-tested proof must throw'
);

const unresolvedRuntime = { ...strictProof, runtimeErrors: [{ message: 'timeout', resolved: false }] };
assert(buildPromotionProposal({ catalog, registry, key: 'http-api-v2', proof: unresolvedRuntime }).failures.includes('unresolved_runtime_errors'));

const unresolvedSettings = { ...strictProof, settingsErrors: ['missing auth account'] };
assert(buildPromotionProposal({ catalog, registry, key: 'http-api-v2', proof: unresolvedSettings }).failures.includes('unresolved_settings_errors'));

const already = promoteCatalogKey({ catalog, registry: promoted.registry, key: 'apollo-enrich-person', proof: strictProof });
assert.strictEqual(already.promoted, false, 'already-registered entries should not be duplicated');
assert.strictEqual(already.registry.entries.length, 39);

console.log(JSON.stringify({ ok: true, checked: 'catalog-promotion-guard', existingEntriesPreserved: 38 }, null, 2));

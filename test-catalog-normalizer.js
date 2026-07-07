#!/usr/bin/env node

const assert = require('assert');
const { normalizeActionsCatalog } = require('./catalog-normalizer');

const fixture = {
  count: 3,
  actions: [
    {
      key: 'lookup-person',
      version: 1,
      package: {
        id: 'pkg-one',
        key: 'PeoplePackage',
        displayName: 'People App',
        categories: ['enrichment_tool'],
      },
      displayName: 'Lookup Person',
      categories: ['people'],
      inputParameterSchema: [{ name: 'email', type: 'text' }],
      outputParameterSchema: [{ name: 'name', type: 'text' }],
      auth: { providerType: 'people-provider' },
      isPublic: true,
    },
    {
      key: 'lookup-person',
      version: 2,
      package: {
        id: 'pkg-two',
        key: 'PeoplePackageV2',
        displayName: 'People App V2',
        categories: ['enrichment_tool', 'crm'],
      },
      displayName: 'Lookup Person (new)',
      categories: ['people', 'crm'],
      inputParameterSchema: [{ name: 'linkedinUrl', type: 'url' }],
      outputParameterSchema: [{ name: 'headline', type: 'text' }],
      auth: { providerType: 'people-provider-v2' },
      isPublic: false,
    },
    {
      key: 'missing-package-action',
      version: 1,
      displayName: 'Missing Package Action',
      inputParameterSchema: [],
      outputParameterSchema: [],
    },
  ],
};

const normalized = normalizeActionsCatalog(fixture, { sourcePath: 'fixture.raw.json' });

assert.strictEqual(normalized.counts.definitions, 3);
assert.strictEqual(normalized.counts.uniqueKeys, 2);
assert.strictEqual(normalized.source.rawCount, 3);

const duplicate = normalized.actions['lookup-person'];
assert(duplicate, 'expected duplicate action key record');
assert.strictEqual(duplicate.definitionCount, 2);
assert.strictEqual(duplicate.variants.length, 2);
assert.deepStrictEqual(duplicate.evidence.rawPointers, ['/actions/0', '/actions/1']);
assert.deepStrictEqual(duplicate.package.ids, ['pkg-one', 'pkg-two']);
assert.deepStrictEqual(duplicate.app.providers, ['people-provider', 'people-provider-v2']);
assert.strictEqual(duplicate.variants[0].inputParameterSchema[0].name, 'email');
assert.strictEqual(duplicate.variants[1].inputParameterSchema[0].name, 'linkedinUrl');

const missing = normalized.actions['missing-package-action'];
assert(missing, 'expected missing package action key record');
assert.strictEqual(missing.package.missingCount, 1);
assert.strictEqual(missing.variants[0].package.missing, true);
assert.strictEqual(missing.variants[0].package.id, null);
assert.strictEqual(missing.variants[0].evidence.rawPackagePointer, null);

console.log(JSON.stringify({ ok: true, checked: 'catalog-normalizer' }, null, 2));

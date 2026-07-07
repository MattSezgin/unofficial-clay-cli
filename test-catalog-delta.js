const assert = require('assert');
const path = require('path');
const { compareCatalogs, readCatalog } = require('./catalog-delta');

const before = readCatalog(path.join(__dirname, 'test/fixtures/catalog-delta-before.json'));
const after = readCatalog(path.join(__dirname, 'test/fixtures/catalog-delta-after.json'));
const report = compareCatalogs(before, after);

assert.deepStrictEqual(report.summary, {
  added: 1,
  removed: 1,
  changed: 1,
  variantChanged: 1,
});

assert.deepStrictEqual(report.added, [{
  key: 'delta-new',
  status: 'cataloged/unclassified',
  versions: [1],
}]);

assert.deepStrictEqual(report.removed, [{
  key: 'gamma-export',
  status: 'stale/potentially_removed',
  previousVersions: [1],
}]);

assert.strictEqual(report.changed[0].key, 'alpha-enrich');
assert.deepStrictEqual(report.changed[0].changedSurfaces, ['package_metadata', 'input_surface', 'output_surface']);

assert.deepStrictEqual(report.variantChanged, [{
  key: 'variant-action',
  beforeVersions: [1],
  afterVersions: [2],
  status: 'cataloged/variant_changed',
}]);

console.log('catalog delta fixture assertions passed');

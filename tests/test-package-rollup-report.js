const assert = require('assert');
const fs = require('fs');
const {
  DEFAULT_HOST_INPUT,
  buildRollup,
  readCatalog,
  renderMarkdown,
} = require('../lib/package-rollup-report');

const fixtureActions = [
  { key: 'z-action', displayName: 'Z action', package: { id: 'pkg-b', key: 'BetaPackage', displayName: 'Beta' } },
  { key: 'a-action', displayName: 'A action', package: { id: 'pkg-a', key: 'AlphaPackage', displayName: 'Alpha' } },
  { key: 'b-action', displayName: 'B action', package: { id: 'pkg-a', key: 'AlphaPackage', displayName: 'Alpha' } },
  { key: 'c-action', displayName: 'C action', package: { id: 'pkg-a', key: 'AlphaPackage', displayName: 'Alpha' } },
  { key: 'd-action', displayName: 'D action', package: { id: 'pkg-b', key: 'BetaPackage', displayName: 'Beta' } },
  { key: 'e-action', displayName: 'E action', package: { id: 'pkg-c', key: 'ClayPackage', displayName: 'Clay' } },
];

const fixtureRollup = buildRollup(fixtureActions, { sampleLimit: 2 });
assert.strictEqual(fixtureRollup.metadata.actionCount, 6);
assert.strictEqual(fixtureRollup.metadata.packageCount, 3);
assert.strictEqual(fixtureRollup.packages[0].displayName, 'Alpha');
assert.strictEqual(fixtureRollup.packages[0].actionCount, 3);
assert.deepStrictEqual(fixtureRollup.packages[0].topSampleActions.map(a => a.key), ['a-action', 'b-action']);
assert.strictEqual(fixtureRollup.packages[1].displayName, 'Beta');
assert.strictEqual(fixtureRollup.packages[1].actionCount, 2);
assert.deepStrictEqual(fixtureRollup.packages[1].topSampleActions.map(a => a.key), ['d-action', 'z-action']);
assert.match(fixtureRollup.metadata.distinction, /action keys are executable Clay actions/);

const markdown = renderMarkdown(fixtureRollup);
assert.match(markdown, /Package\/app\/provider count: 3/);
assert.match(markdown, /Action key count: 6/);
assert.match(markdown, /Top sample action keys/);

if (fs.existsSync(DEFAULT_HOST_INPUT)) {
  const catalogRollup = buildRollup(readCatalog(DEFAULT_HOST_INPUT));
  assert.strictEqual(catalogRollup.metadata.actionCount, 1282);
  assert.strictEqual(catalogRollup.metadata.packageCount, 269);
  assert.deepStrictEqual(
    catalogRollup.packages.slice(0, 4).map(pkg => [pkg.displayName, pkg.actionCount]),
    [
      ['Companies, People, Jobs', 63],
      ['Clay', 47],
      ['Salesforce', 44],
      ['HubSpot', 33],
    ]
  );
}

console.log('package rollup report tests passed');

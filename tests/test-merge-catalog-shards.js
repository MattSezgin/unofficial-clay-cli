'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildMergedIndex, validateShard, SHARD_SCHEMA_VERSION } = require('../lib/merge-catalog-shards');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-merge-shards-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withTempDir((dir) => {
  const raw = path.join(dir, 'raw.json');
  const shards = path.join(dir, 'shards');
  writeJson(raw, {
    count: 3,
    actions: [
      { key: 'alpha-lookup', displayName: 'Alpha lookup', package: { key: 'AlphaPackage', displayName: 'Alpha' } },
      { key: 'alpha-lookup', displayName: 'Alpha lookup v2', package: { key: 'AlphaPackage', displayName: 'Alpha' } },
      { key: 'beta-write', displayName: 'Beta write', package: { key: 'BetaPackage', displayName: 'Beta' } },
    ],
  });
  writeJson(path.join(shards, '001.json'), {
    schemaVersion: SHARD_SCHEMA_VERSION,
    shardId: '001',
    actions: [
      { key: 'alpha-lookup', catalogStatus: 'classified', safetyClass: 'safe_read_enrichment', proofStrategy: 'one_row_live_readback' },
      { key: 'alpha-lookup', catalogStatus: 'classified', safetyClass: 'safe_read_enrichment', proofStrategy: 'one_row_live_readback' },
    ],
  });
  writeJson(path.join(shards, '002.json'), {
    schemaVersion: SHARD_SCHEMA_VERSION,
    shardId: '002',
    actions: [
      { key: 'beta-write', catalogStatus: 'blocked', safetyClass: 'external_write_mutation', proofStrategy: 'external_sandbox_required' },
    ],
  });

  const { index, dashboard, conflicts } = buildMergedIndex({ raw, shards, generatedAt: '2026-06-10T00:00:00.000Z' });
  assert.strictEqual(conflicts.length, 0, 'identical duplicate shard entries should not conflict');
  assert.strictEqual(index.actions['alpha-lookup'].definitionCount, 2, 'raw duplicate definitions should be counted');
  assert.strictEqual(index.actions['alpha-lookup'].catalogStatus, 'classified');
  assert.deepStrictEqual(index.actions['alpha-lookup'].shardIds, ['001']);
  assert.strictEqual(index.actions['beta-write'].catalogStatus, 'blocked');
  assert.deepStrictEqual(dashboard.catalogStatuses, { blocked: 1, classified: 1 });
  assert.strictEqual(dashboard.counts.duplicateRawDefinitions, 1);
});

withTempDir((dir) => {
  const raw = path.join(dir, 'raw.json');
  const shards = path.join(dir, 'shards');
  writeJson(raw, { actions: [{ key: 'alpha-lookup', displayName: 'Alpha lookup' }] });
  writeJson(path.join(shards, '001.json'), {
    schemaVersion: SHARD_SCHEMA_VERSION,
    shardId: '001',
    actions: [{ key: 'alpha-lookup', catalogStatus: 'classified', safetyClass: 'safe_read_enrichment' }],
  });
  writeJson(path.join(shards, '002.json'), {
    schemaVersion: SHARD_SCHEMA_VERSION,
    shardId: '002',
    actions: [{ key: 'alpha-lookup', catalogStatus: 'blocked', safetyClass: 'external_write_mutation' }],
  });

  const { index, dashboard, conflicts } = buildMergedIndex({ raw, shards });
  assert.strictEqual(conflicts.length, 1, 'conflicting shard classifications should be surfaced');
  assert.strictEqual(conflicts[0].key, 'alpha-lookup');
  assert.deepStrictEqual(conflicts[0].fields.sort(), ['catalogStatus', 'safetyClass']);
  assert.strictEqual(index.actions['alpha-lookup'].catalogStatus, 'cataloged', 'conflicted entry should not be applied');
  assert.strictEqual(dashboard.counts.conflictedActions, 1);
});

assert.throws(() => validateShard({ schemaVersion: SHARD_SCHEMA_VERSION, shardId: 'bad', actions: [{ key: 'x', catalogStatus: 'battle-tested' }] }, 'bad.json'), /catalogStatus/);
assert.throws(() => validateShard({ schemaVersion: 'wrong', shardId: 'bad', actions: [] }, 'bad.json'), /schemaVersion/);

console.log('merge catalog shard tests passed');

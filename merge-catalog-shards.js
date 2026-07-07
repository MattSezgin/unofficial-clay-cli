#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const RAW_FALLBACK = path.join(__dirname, 'runs/2026-06-09/full-integration-audit-shards/actions-catalog.raw.json');
const SHARD_SCHEMA_VERSION = 'clay-catalog-shard-output/v1';
const MERGED_SCHEMA_VERSION = 'clay-catalog-merged-index/v1';
const VALID_STATUSES = new Set(['cataloged', 'classified', 'template_ready', 'proof_queued', 'strict_battle_tested', 'blocked', 'excluded']);

function parseArgs(argv) {
  const args = {
    raw: path.join(__dirname, 'runs/2026-06-09/full-integration-audit-shards/actions-catalog.raw.json'),
    shards: path.join(__dirname, 'runs/2026-06-10/catalog-shards'),
    out: path.join(__dirname, 'docs/catalog-merged-index.json'),
    dashboard: path.join(__dirname, 'docs/catalog-coverage-dashboard.json'),
    conflicts: path.join(__dirname, 'docs/catalog-shard-conflicts.json'),
    allowConflicts: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--raw') args.raw = argv[++i];
    else if (arg === '--shards') args.shards = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--dashboard') args.dashboard = argv[++i];
    else if (arg === '--conflicts') args.conflicts = argv[++i];
    else if (arg === '--allow-conflicts') args.allowConflicts = true;
    else if (arg === '--help') {
      console.log('Usage: node merge-catalog-shards.js [--raw file] [--shards dir-or-file] [--out file] [--dashboard file] [--conflicts file] [--allow-conflicts]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function listShardFiles(input) {
  if (!fs.existsSync(input)) return [];
  const stat = fs.statSync(input);
  if (stat.isFile()) return input.endsWith('.json') ? [input] : [];
  return fs.readdirSync(input)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(input, name))
    .sort();
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function validateShard(shard, file) {
  assertObject(shard, `${file} shard`);
  if (shard.schemaVersion !== SHARD_SCHEMA_VERSION) {
    throw new Error(`${file} schemaVersion must be ${SHARD_SCHEMA_VERSION}`);
  }
  if (!shard.shardId || typeof shard.shardId !== 'string') {
    throw new Error(`${file} shardId must be a non-empty string`);
  }
  if (!Array.isArray(shard.actions)) {
    throw new Error(`${file} actions must be an array`);
  }
  shard.actions.forEach((entry, index) => {
    assertObject(entry, `${file} actions[${index}]`);
    if (!entry.key || typeof entry.key !== 'string') {
      throw new Error(`${file} actions[${index}].key must be a non-empty string`);
    }
    if (!entry.catalogStatus || !VALID_STATUSES.has(entry.catalogStatus)) {
      throw new Error(`${file} actions[${index}].catalogStatus must be one of: ${Array.from(VALID_STATUSES).join(', ')}`);
    }
    for (const field of ['safetyClass', 'proofStrategy', 'templatePath', 'docPath', 'notes']) {
      if (entry[field] !== undefined && typeof entry[field] !== 'string') {
        throw new Error(`${file} actions[${index}].${field} must be a string when present`);
      }
    }
  });
  return shard;
}

function loadRawActions(rawPath) {
  const resolved = fs.existsSync(rawPath) ? rawPath : RAW_FALLBACK;
  if (!fs.existsSync(resolved)) throw new Error(`Raw catalog artifact not found: ${rawPath}`);
  const raw = readJson(resolved);
  const actions = Array.isArray(raw) ? raw : raw.actions;
  if (!Array.isArray(actions)) throw new Error('Raw catalog must be an array or contain actions[]');
  return { rawPath: resolved, actions };
}

function compactBaseAction(def) {
  const pkg = def.package || {};
  return {
    key: def.key,
    displayName: def.displayName || def.key,
    packageKey: pkg.key || null,
    packageName: pkg.displayName || null,
    definitionCount: 0,
    catalogStatus: 'cataloged',
    shardIds: [],
  };
}

function conflictFields(a, b) {
  return ['catalogStatus', 'safetyClass', 'proofStrategy', 'templatePath', 'docPath'].filter((field) => {
    return a[field] !== undefined && b[field] !== undefined && a[field] !== b[field];
  });
}

function buildMergedIndex(options = {}) {
  const { rawPath, actions: rawActions } = loadRawActions(options.raw || RAW_FALLBACK);
  const byKey = new Map();
  for (const def of rawActions) {
    if (!def || !def.key) continue;
    if (!byKey.has(def.key)) byKey.set(def.key, compactBaseAction(def));
    byKey.get(def.key).definitionCount += 1;
  }

  const shardFiles = listShardFiles(options.shards || '');
  const shardEntriesByKey = new Map();
  const schemaErrors = [];
  for (const file of shardFiles) {
    try {
      const shard = validateShard(readJson(file), file);
      for (const entry of shard.actions) {
        if (!shardEntriesByKey.has(entry.key)) shardEntriesByKey.set(entry.key, []);
        shardEntriesByKey.get(entry.key).push({ ...entry, shardId: shard.shardId, shardFile: file });
      }
    } catch (error) {
      schemaErrors.push({ file, error: error.message });
    }
  }
  if (schemaErrors.length > 0) {
    const err = new Error(`Shard schema validation failed for ${schemaErrors.length} file(s)`);
    err.schemaErrors = schemaErrors;
    throw err;
  }

  const conflicts = [];
  for (const [key, entries] of shardEntriesByKey.entries()) {
    const first = entries[0];
    const fields = Array.from(new Set(entries.slice(1).flatMap((entry) => conflictFields(first, entry))));
    if (fields.length > 0) {
      conflicts.push({ key, fields, entries });
      continue;
    }
    const target = byKey.get(key) || { key, displayName: key, packageKey: null, packageName: null, definitionCount: 0, catalogStatus: 'cataloged', shardIds: [] };
    for (const field of ['catalogStatus', 'safetyClass', 'proofStrategy', 'templatePath', 'docPath', 'notes']) {
      if (first[field] !== undefined) target[field] = first[field];
    }
    target.shardIds = Array.from(new Set(entries.map((entry) => entry.shardId))).sort();
    byKey.set(key, target);
  }

  const mergedActions = Object.fromEntries(Array.from(byKey.entries()).sort(([a], [b]) => a.localeCompare(b)));
  const generatedAt = options.generatedAt || null;
  const dashboard = buildDashboard(mergedActions, { rawPath, shardFiles, conflicts, generatedAt });
  return {
    index: {
      schemaVersion: MERGED_SCHEMA_VERSION,
      generatedAt,
      source: { rawPath, shardFiles },
      counts: dashboard.counts,
      actions: mergedActions,
      conflicts,
    },
    dashboard,
    conflicts,
  };
}

function countBy(values, select) {
  const counts = {};
  for (const value of values) {
    const key = select(value) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function buildDashboard(actions, context) {
  const records = Object.values(actions);
  return {
    generatedAt: context.generatedAt || null,
    source: context,
    counts: {
      uniqueActions: records.length,
      duplicateRawDefinitions: records.reduce((sum, record) => sum + Math.max(0, record.definitionCount - 1), 0),
      shardFiles: context.shardFiles.length,
      conflictedActions: context.conflicts.length,
      classifiedByShard: records.filter((record) => record.shardIds && record.shardIds.length > 0).length,
    },
    catalogStatuses: countBy(records, (record) => record.catalogStatus),
    safetyClasses: countBy(records.filter((record) => record.safetyClass), (record) => record.safetyClass),
    proofStrategies: countBy(records.filter((record) => record.proofStrategy), (record) => record.proofStrategy),
  };
}

function main() {
  const args = parseArgs(process.argv);
  const { index, dashboard, conflicts } = buildMergedIndex(args);
  writeJson(args.out, index);
  writeJson(args.dashboard, dashboard);
  writeJson(args.conflicts, conflicts);
  if (conflicts.length > 0 && !args.allowConflicts) {
    console.error(`catalog shard merge surfaced ${conflicts.length} conflicting action(s); see ${args.conflicts}`);
    process.exitCode = 2;
    return;
  }
  console.log(`merged ${dashboard.counts.uniqueActions} action keys from ${dashboard.counts.shardFiles} shard file(s)`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    if (error.schemaErrors) console.error(JSON.stringify(error.schemaErrors, null, 2));
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  SHARD_SCHEMA_VERSION,
  MERGED_SCHEMA_VERSION,
  validateShard,
  buildMergedIndex,
  buildDashboard,
};

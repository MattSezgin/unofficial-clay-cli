#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex').slice(0, 16);
}

function readCatalog(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const actions = Array.isArray(data) ? data : data.actions;
  if (!Array.isArray(actions)) throw new Error(`catalog does not contain an actions array: ${file}`);
  return actions;
}

function arrayOfNames(schema) {
  if (!Array.isArray(schema)) return [];
  return schema.map(param => ({
    name: param.name || param.key || param.id || null,
    type: param.type || param.dataType || param.parameterType || null,
    required: param.required === undefined ? null : Boolean(param.required),
    path: param.path || param.jsonPath || null,
  }));
}

function actionIdentity(action) {
  return {
    key: action.key || action.actionKey || action.id,
    version: Number(action.version || action.actionVersion || 1),
  };
}

function normalizeAction(action) {
  const { key, version } = actionIdentity(action);
  if (!key) throw new Error('action is missing key/actionKey/id');
  const pkg = action.package || {};
  const packageMetadata = {
    id: pkg.id || action.actionPackageId || null,
    key: pkg.key || null,
    displayName: pkg.displayName || null,
    categories: pkg.categories || [],
    vpcLambdaOnly: pkg.vpcLambdaOnly === undefined ? null : pkg.vpcLambdaOnly,
  };
  const inputSurface = arrayOfNames(action.inputParameterSchema || action.inputs || action.inputSchema || []);
  const outputSurface = arrayOfNames(action.outputParameterSchema || action.outputs || action.outputSchema || []);
  return {
    key,
    version,
    actionVariantKey: `${key}@v${version}`,
    displayName: action.displayName || null,
    description: action.description || null,
    packageMetadata,
    inputSurface,
    outputSurface,
    packageMetadataHash: stableHash(packageMetadata),
    inputSurfaceHash: stableHash(inputSurface),
    outputSurfaceHash: stableHash(outputSurface),
  };
}

function indexCatalog(actions) {
  const byKey = new Map();
  const byVariant = new Map();
  for (const action of actions) {
    const normalized = normalizeAction(action);
    if (!byKey.has(normalized.key)) byKey.set(normalized.key, []);
    byKey.get(normalized.key).push(normalized);
    byVariant.set(normalized.actionVariantKey, normalized);
  }
  for (const variants of byKey.values()) variants.sort((a, b) => a.version - b.version);
  return { byKey, byVariant };
}

function versionsFor(index, key) {
  return (index.byKey.get(key) || []).map(action => action.version);
}

function compareCatalogs(beforeActions, afterActions) {
  const before = indexCatalog(beforeActions);
  const after = indexCatalog(afterActions);
  const beforeKeys = new Set(before.byKey.keys());
  const afterKeys = new Set(after.byKey.keys());
  const added = [];
  const removed = [];
  const changed = [];
  const variantChanged = [];

  for (const key of [...afterKeys].sort()) {
    if (!beforeKeys.has(key)) {
      added.push({ key, status: 'cataloged/unclassified', versions: versionsFor(after, key) });
    }
  }

  for (const key of [...beforeKeys].sort()) {
    if (!afterKeys.has(key)) {
      removed.push({ key, status: 'stale/potentially_removed', previousVersions: versionsFor(before, key) });
    }
  }

  for (const key of [...afterKeys].filter(key => beforeKeys.has(key)).sort()) {
    const beforeVersions = versionsFor(before, key);
    const afterVersions = versionsFor(after, key);
    if (JSON.stringify(beforeVersions) !== JSON.stringify(afterVersions)) {
      variantChanged.push({ key, beforeVersions, afterVersions, status: 'cataloged/variant_changed' });
    }
  }

  for (const [variantKey, afterAction] of [...after.byVariant.entries()].sort()) {
    const beforeAction = before.byVariant.get(variantKey);
    if (!beforeAction) continue;
    const changes = [];
    if (beforeAction.packageMetadataHash !== afterAction.packageMetadataHash) changes.push('package_metadata');
    if (beforeAction.inputSurfaceHash !== afterAction.inputSurfaceHash) changes.push('input_surface');
    if (beforeAction.outputSurfaceHash !== afterAction.outputSurfaceHash) changes.push('output_surface');
    if (changes.length) {
      changed.push({
        key: afterAction.key,
        version: afterAction.version,
        actionVariantKey: variantKey,
        changedSurfaces: changes,
        before: {
          packageMetadataHash: beforeAction.packageMetadataHash,
          inputSurfaceHash: beforeAction.inputSurfaceHash,
          outputSurfaceHash: beforeAction.outputSurfaceHash,
        },
        after: {
          packageMetadataHash: afterAction.packageMetadataHash,
          inputSurfaceHash: afterAction.inputSurfaceHash,
          outputSurfaceHash: afterAction.outputSurfaceHash,
        },
      });
    }
  }

  return {
    beforeCount: beforeActions.length,
    afterCount: afterActions.length,
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      variantChanged: variantChanged.length,
    },
    added,
    removed,
    changed,
    variantChanged,
  };
}

function writeReport(report, outFile) {
  const text = JSON.stringify(report, null, 2) + '\n';
  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, text);
  } else {
    process.stdout.write(text);
  }
}

function main(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else args._.push(arg);
  }
  const [beforeFile, afterFile] = args._;
  if (!beforeFile || !afterFile) throw new Error('usage: catalog-delta <stored-catalog.json> <new-catalog.json> [--out report.json]');
  const report = compareCatalogs(readCatalog(beforeFile), readCatalog(afterFile));
  writeReport(report, args.out);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { compareCatalogs, normalizeAction, readCatalog };

const fs = require('fs');
const path = require('path');

const CATALOG_SCHEMA_VERSION = 'clay-actions-normalized-catalog/v1';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePackage(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    return {
      id: null,
      key: null,
      displayName: null,
      icon: null,
      categories: [],
      termsAndConditions: null,
      vpcLambdaOnly: null,
      missing: true,
    };
  }
  return {
    id: pkg.id ?? null,
    key: pkg.key ?? null,
    displayName: pkg.displayName ?? null,
    icon: pkg.icon ?? null,
    categories: asArray(pkg.categories),
    termsAndConditions: pkg.termsAndConditions ?? null,
    vpcLambdaOnly: pkg.vpcLambdaOnly ?? null,
    missing: false,
  };
}

function unique(values) {
  return [...new Set(values.filter(v => v !== null && v !== undefined && v !== ''))];
}

function providerFromDefinition(definition, pkg) {
  return definition.auth?.providerType || definition.auth?.type || definition.providerType || pkg.key || null;
}

function normalizeVariant(definition, rawIndex) {
  const pkg = normalizePackage(definition.package);
  return {
    variantId: `${definition.key || '<missing-key>'}#${rawIndex}`,
    rawIndex,
    rawPointer: `/actions/${rawIndex}`,
    key: definition.key ?? null,
    version: definition.version ?? null,
    displayName: definition.displayName ?? null,
    description: definition.description ?? null,
    package: pkg,
    provider: providerFromDefinition(definition, pkg),
    app: {
      packageId: pkg.id,
      packageKey: pkg.key,
      packageDisplayName: pkg.displayName,
      provider: providerFromDefinition(definition, pkg),
    },
    categories: asArray(definition.categories),
    actionLabels: definition.actionLabels || {},
    isPublic: definition.isPublic ?? null,
    isSource: definition.isSource ?? false,
    canPreview: definition.canPreview ?? null,
    documentationUri: definition.documentationUri ?? null,
    iconUri: definition.iconUri ?? null,
    inputParameterSchema: asArray(definition.inputParameterSchema),
    outputParameterSchema: asArray(definition.outputParameterSchema),
    suggestedOutputParams: asArray(definition.suggestedOutputParams),
    requiredInputCombinations: asArray(definition.requiredInputCombinations),
    actionEnablementInfo: definition.actionEnablementInfo || null,
    pricing: definition.pricing || null,
    batchSettings: definition.batchSettings || null,
    evidence: {
      rawPointer: `/actions/${rawIndex}`,
      rawKey: definition.key ?? null,
      rawVersion: definition.version ?? null,
      rawPackagePointer: definition.package ? `/actions/${rawIndex}/package` : null,
    },
  };
}

function normalizeActionsCatalog(raw, options = {}) {
  const definitions = Array.isArray(raw) ? raw : asArray(raw && raw.actions);
  const actions = {};
  const definitionWarnings = [];

  definitions.forEach((definition, rawIndex) => {
    if (!definition || typeof definition !== 'object') {
      definitionWarnings.push({ rawIndex, rawPointer: `/actions/${rawIndex}`, warning: 'definition_not_object' });
      return;
    }
    const key = definition.key;
    if (!key) {
      definitionWarnings.push({ rawIndex, rawPointer: `/actions/${rawIndex}`, warning: 'missing_key' });
      return;
    }
    const variant = normalizeVariant(definition, rawIndex);
    if (!actions[key]) {
      actions[key] = {
        key,
        definitionCount: 0,
        displayNames: [],
        package: {
          ids: [],
          keys: [],
          displayNames: [],
          categories: [],
          missingCount: 0,
        },
        app: {
          providers: [],
          packageKeys: [],
          packageDisplayNames: [],
        },
        categories: [],
        variants: [],
        evidence: {
          rawPointers: [],
          rawIndexes: [],
        },
      };
    }
    const record = actions[key];
    record.definitionCount += 1;
    record.displayNames = unique([...record.displayNames, variant.displayName]);
    record.package.ids = unique([...record.package.ids, variant.package.id]);
    record.package.keys = unique([...record.package.keys, variant.package.key]);
    record.package.displayNames = unique([...record.package.displayNames, variant.package.displayName]);
    record.package.categories = unique([...record.package.categories, ...variant.package.categories]);
    if (variant.package.missing) record.package.missingCount += 1;
    record.app.providers = unique([...record.app.providers, variant.provider]);
    record.app.packageKeys = unique([...record.app.packageKeys, variant.package.key]);
    record.app.packageDisplayNames = unique([...record.app.packageDisplayNames, variant.package.displayName]);
    record.categories = unique([...record.categories, ...variant.categories]);
    record.variants.push(variant);
    record.evidence.rawPointers.push(variant.evidence.rawPointer);
    record.evidence.rawIndexes.push(rawIndex);
  });

  const uniqueKeyCount = Object.keys(actions).length;
  const definitionCount = definitions.length;
  const duplicateKeyCount = Object.values(actions).filter(record => record.definitionCount > 1).length;
  const duplicateVariantCount = definitionCount - uniqueKeyCount;

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt: options.generatedAt || null,
    source: {
      path: options.sourcePath || null,
      rawCount: raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.count ?? null : null,
    },
    counts: {
      definitions: definitionCount,
      uniqueKeys: uniqueKeyCount,
      duplicateKeys: duplicateKeyCount,
      duplicateVariants: duplicateVariantCount,
      warnings: definitionWarnings.length,
    },
    actions,
    warnings: definitionWarnings,
  };
}

function readAndNormalizeActionsCatalog(inputPath, options = {}) {
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  return normalizeActionsCatalog(raw, { ...options, sourcePath: path.resolve(inputPath) });
}

module.exports = {
  CATALOG_SCHEMA_VERSION,
  normalizeActionsCatalog,
  readAndNormalizeActionsCatalog,
  normalizePackage,
};

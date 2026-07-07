#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CATALOG_PATH = path.join(
  __dirname,
  '..',
  'runs/2026-06-09/full-integration-audit-shards/actions-catalog.raw.json',
);

const SAFETY_CLASSES = [
  'destructive',
  'bulk',
  'purchase',
  'auth',
  'source',
  'mutation',
  'internal_deprecated',
  'read_enrichment',
  'unknown_requires_review',
];

const CLASS_RANK = new Map(SAFETY_CLASSES.map((name, index) => [name, index]));

const RULES = [
  {
    safetyClass: 'destructive',
    patterns: [/\bdelete\b/, /\bremove\b/, /\brevoke\b/, /\barchive\b/, /\bdisable\b/, /\bdisconnect\b/],
    reason: 'destructive verb in key/name/description',
  },
  {
    safetyClass: 'bulk',
    patterns: [/\bbulk\b/, /\bbatch\b/, /\bmass\b/],
    reason: 'bulk/batch semantics in key/name/description',
  },
  {
    safetyClass: 'purchase',
    patterns: [/\bpurchase\b/, /\bbuy\b/, /\bcharge\b/, /\bcredit(?:s)?\b/, /\bbill(?:ing|ed)?\b/, /\bpaid\b/, /\btransaction\b/],
    reason: 'purchase/credit/billing semantics or priced execution metadata',
  },
  {
    safetyClass: 'auth',
    patterns: [/\bvalidate[-_ ]?auth\b/, /\bauth\b/, /\bapi key\b/, /\boauth\b/, /\btoken\b/, /\bcredential\b/],
    reason: 'authentication or credential-validation semantics',
  },
  {
    safetyClass: 'source',
    patterns: [/\bsource\b/, /\bimport\b/, /\bpull data\b/, /\bsearch\b/],
    reason: 'source/import/search action semantics',
  },
  {
    safetyClass: 'mutation',
    patterns: [/\bcreate\b/, /\bupdate\b/, /\bupsert\b/, /\badd\b/, /\bsend\b/, /\bpush\b/, /\bexport\b/, /\bpost\b/, /\bpatch\b/, /\bsync\b/, /\bsubmit\b/, /\btrigger\b/, /\blaunch\b/],
    reason: 'write/export/send verb in key/name/description',
  },
  {
    safetyClass: 'internal_deprecated',
    patterns: [/\bdeprecated\b/, /\binternal\b/, /\bstaging\b/, /\blegacy\b/, /\btest\b/, /\bdebug\b/],
    reason: 'internal/deprecated/staging semantics or non-public catalog metadata',
  },
  {
    safetyClass: 'read_enrichment',
    patterns: [/\bfind\b/, /\blookup\b/, /\benrich\b/, /\bverify\b/, /\bget\b/, /\bretrieve\b/, /\bscore\b/, /\bclassify\b/, /\bnormalize\b/, /\bparse\b/, /\bextract\b/, /\bscrape\b/, /\bcalculate\b/, /\bgenerate\b/],
    reason: 'read/enrichment verb in key/name/description',
  },
];

function textFor(action) {
  return [
    action.key,
    action.displayName,
    action.description,
    action.package?.key,
    action.package?.displayName,
    ...(action.categories || []),
    action.actionLabels?.type,
    ...(action.actionLabels?.tags || []),
  ]
    .flat()
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function hasPricing(action) {
  return Boolean(action.pricing && JSON.stringify(action.pricing).match(/"actionExecution"\s*:\s*[1-9]/));
}

function collectEvidence(action) {
  const evidence = [];
  const haystack = textFor(action);

  for (const rule of RULES) {
    if (rule.patterns.some(pattern => pattern.test(haystack))) {
      evidence.push({ safetyClass: rule.safetyClass, reason: rule.reason });
    }
  }

  const labelType = action.actionLabels?.type;
  const labelTypes = Array.isArray(labelType) ? labelType : [labelType].filter(Boolean);
  if (labelTypes.some(type => String(type).toLowerCase() === 'send data')) {
    evidence.push({ safetyClass: 'mutation', reason: 'catalog actionLabels.type includes Send Data' });
  }
  if (labelTypes.some(type => String(type).toLowerCase() === 'add data')) {
    evidence.push({ safetyClass: 'source', reason: 'catalog actionLabels.type includes Add Data' });
  }
  if ((action.categories || []).includes('enrichment_tool') || labelTypes.some(type => String(type).toLowerCase() === 'enrich data')) {
    evidence.push({ safetyClass: 'read_enrichment', reason: 'catalog categories/type mark enrichment' });
  }
  if (hasPricing(action)) {
    evidence.push({ safetyClass: 'purchase', reason: 'pricing metadata charges credits for action execution' });
  }
  if (action.isPublic === false) {
    evidence.push({ safetyClass: 'internal_deprecated', reason: 'catalog isPublic=false' });
  }

  return evidence;
}

function primaryClassFromEvidence(evidence) {
  if (!evidence.length) return 'unknown_requires_review';
  return evidence
    .map(item => item.safetyClass)
    .sort((a, b) => CLASS_RANK.get(a) - CLASS_RANK.get(b))[0] || 'unknown_requires_review';
}

function classifyAction(action) {
  const evidence = collectEvidence(action);
  const primarySafetyClass = primaryClassFromEvidence(evidence);
  return {
    key: action.key,
    version: action.version ?? null,
    packageKey: action.package?.key || null,
    packageDisplayName: action.package?.displayName || null,
    displayName: action.displayName || null,
    primarySafetyClass,
    candidateSafetyClasses: [...new Set(evidence.map(item => item.safetyClass).concat(primarySafetyClass))],
    evidence: evidence.length ? evidence : [{ safetyClass: 'unknown_requires_review', reason: 'no deterministic metadata or action-key rule matched' }],
  };
}

function mergeByKey(classifiedActions) {
  const grouped = new Map();
  for (const item of classifiedActions) {
    if (!grouped.has(item.key)) grouped.set(item.key, []);
    grouped.get(item.key).push(item);
  }

  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, variants]) => {
    const classes = variants.map(variant => variant.primarySafetyClass);
    const primarySafetyClass = classes.sort((a, b) => CLASS_RANK.get(a) - CLASS_RANK.get(b))[0] || 'unknown_requires_review';
    const candidateSafetyClasses = [...new Set(variants.flatMap(variant => variant.candidateSafetyClasses))]
      .sort((a, b) => CLASS_RANK.get(a) - CLASS_RANK.get(b));
    return {
      key,
      primarySafetyClass,
      candidateSafetyClasses,
      variantCount: variants.length,
      variants: variants.map(variant => ({
        version: variant.version,
        packageKey: variant.packageKey,
        packageDisplayName: variant.packageDisplayName,
        displayName: variant.displayName,
        primarySafetyClass: variant.primarySafetyClass,
        evidence: variant.evidence,
      })),
    };
  });
}

function classifyCatalog(catalog, options = {}) {
  const actions = Array.isArray(catalog) ? catalog : catalog.actions;
  if (!Array.isArray(actions)) throw new Error('Catalog must be an array or an object with actions[]');
  const perAction = actions.map(classifyAction);
  const classifications = options.byKey === false ? perAction : mergeByKey(perAction);
  const countsByClass = Object.fromEntries(SAFETY_CLASSES.map(name => [name, 0]));
  for (const item of classifications) countsByClass[item.primarySafetyClass] += 1;
  return {
    schemaVersion: 1,
    classificationMode: options.byKey === false ? 'per_action_variant' : 'per_catalog_key',
    safetyClasses: SAFETY_CLASSES,
    totalInputActions: actions.length,
    totalClassifications: classifications.length,
    countsByClass,
    classifications,
  };
}

function parseArgs(argv) {
  const args = { input: null, output: null, byKey: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--per-action') args.byKey = false;
    else if (arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function resolveInput(input) {
  if (input) return input;
  return DEFAULT_CATALOG_PATH;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write('Usage: node lib/safety-classifier.js [--input actions-catalog.raw.json] [--output classifications.json] [--per-action]\n');
    return;
  }
  const input = resolveInput(args.input);
  const catalog = JSON.parse(fs.readFileSync(input, 'utf8'));
  const result = classifyCatalog(catalog, { byKey: args.byKey });
  result.source = { inputFile: path.basename(input) };
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, output);
  } else {
    process.stdout.write(output);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  SAFETY_CLASSES,
  classifyAction,
  classifyCatalog,
  collectEvidence,
  mergeByKey,
};

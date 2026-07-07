#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DEFAULT_RELATIVE_INPUT = path.join(__dirname, 'runs/2026-06-09/full-integration-audit-shards/actions-catalog.raw.json');
// Kept as a distinct export (some callers/tests look for a secondary fallback
// path) but pointed at the same __dirname-relative location - no machine-
// specific absolute path is embedded here anymore.
const DEFAULT_HOST_INPUT = DEFAULT_RELATIVE_INPUT;
const DEFAULT_OUT_DIR = path.join(__dirname, 'runs/2026-06-09/full-integration-audit-shards');
const DEFAULT_SAMPLE_LIMIT = 5;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) args[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[a.slice(2)] = argv[++i];
      else args[a.slice(2)] = true;
    } else args._.push(a);
  }
  return args;
}

function resolveInput(input) {
  if (input) return input;
  if (fs.existsSync(DEFAULT_RELATIVE_INPUT)) return DEFAULT_RELATIVE_INPUT;
  return DEFAULT_HOST_INPUT;
}

function readCatalog(inputPath) {
  const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const actions = Array.isArray(parsed) ? parsed : parsed.actions;
  if (!Array.isArray(actions)) throw new Error('expected catalog JSON with actions array');
  return actions;
}

function normalizePackage(action) {
  const pkg = action && action.package && typeof action.package === 'object' ? action.package : {};
  return {
    id: pkg.id || 'missing-package-id',
    key: pkg.key || 'missing-package-key',
    displayName: pkg.displayName || pkg.key || 'Missing package',
  };
}

function compareActionSample(a, b) {
  return String(a.key).localeCompare(String(b.key))
    || String(a.displayName).localeCompare(String(b.displayName));
}

function comparePackages(a, b) {
  return b.actionCount - a.actionCount
    || String(a.displayName).localeCompare(String(b.displayName))
    || String(a.packageKey).localeCompare(String(b.packageKey))
    || String(a.packageId).localeCompare(String(b.packageId));
}

function buildRollup(actions, options = {}) {
  const sampleLimit = Number(options.sampleLimit || DEFAULT_SAMPLE_LIMIT);
  const packages = new Map();

  for (const action of actions) {
    const pkg = normalizePackage(action || {});
    const groupKey = `${pkg.id}\u0000${pkg.key}`;
    if (!packages.has(groupKey)) {
      packages.set(groupKey, {
        displayName: pkg.displayName,
        packageKey: pkg.key,
        packageId: pkg.id,
        actionCount: 0,
        topSampleActions: [],
        _allActions: [],
      });
    }
    const group = packages.get(groupKey);
    group.actionCount += 1;
    group._allActions.push({
      key: action.key || 'missing-action-key',
      displayName: action.displayName || action.key || 'Missing action display name',
    });
  }

  const packageRows = Array.from(packages.values()).map(group => {
    const samples = group._allActions.slice().sort(compareActionSample).slice(0, sampleLimit);
    const { _allActions, ...row } = group;
    return { ...row, topSampleActions: samples };
  }).sort(comparePackages);

  return {
    metadata: {
      generatedAt: new Date(0).toISOString(),
      reportType: 'clay-action-package-rollup',
      distinction: 'action keys are executable Clay actions; packages/apps/providers are human integration units that group action keys',
      actionCount: actions.length,
      packageCount: packageRows.length,
      sampleLimit,
      ordering: 'packages sorted by actionCount desc, displayName, packageKey, packageId; sample actions sorted by action key',
    },
    packages: packageRows,
  };
}

function renderMarkdown(rollup) {
  const lines = [];
  lines.push('# Clay action package/app/provider rollup');
  lines.push('');
  lines.push(`- Package/app/provider count: ${rollup.metadata.packageCount}`);
  lines.push(`- Action key count: ${rollup.metadata.actionCount}`);
  lines.push('- Distinction: action keys are executable Clay actions; packages/apps/providers are human integration units that group action keys.');
  lines.push('- Ordering: packages sorted by action count descending, then display name/package key/package id.');
  lines.push('');
  lines.push('| Rank | Display name | Package key | Package id | Action count | Top sample action keys |');
  lines.push('| ---: | --- | --- | --- | ---: | --- |');
  rollup.packages.forEach((pkg, index) => {
    const samples = pkg.topSampleActions.map(a => `\`${escapePipes(a.key)}\``).join(', ');
    lines.push(`| ${index + 1} | ${escapePipes(pkg.displayName)} | \`${escapePipes(pkg.packageKey)}\` | \`${escapePipes(pkg.packageId)}\` | ${pkg.actionCount} | ${samples} |`);
  });
  lines.push('');
  return lines.join('\n');
}

function escapePipes(value) {
  return String(value).replace(/\|/g, '\\|');
}

function writeOutputs(rollup, outDir, basename = 'actions-catalog.package-rollup') {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${basename}.json`);
  const mdPath = path.join(outDir, `${basename}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(rollup, null, 2) + '\n');
  fs.writeFileSync(mdPath, renderMarkdown(rollup));
  return { jsonPath, mdPath };
}

function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  const inputPath = resolveInput(flags.input || flags._[0]);
  const outDir = flags['out-dir'] || DEFAULT_OUT_DIR;
  const sampleLimit = flags['sample-limit'] || DEFAULT_SAMPLE_LIMIT;
  const actions = readCatalog(inputPath);
  const rollup = buildRollup(actions, { sampleLimit });
  const wrote = writeOutputs(rollup, outDir, flags.basename || 'actions-catalog.package-rollup');
  console.log(JSON.stringify({ inputPath, ...wrote, packageCount: rollup.metadata.packageCount, actionCount: rollup.metadata.actionCount }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_HOST_INPUT,
  buildRollup,
  comparePackages,
  renderMarkdown,
  readCatalog,
  resolveInput,
  writeOutputs,
};

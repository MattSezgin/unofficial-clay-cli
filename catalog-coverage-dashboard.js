#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_RAW = path.join(__dirname, 'runs/2026-06-09/full-integration-audit-shards/actions-catalog.raw.json');
const DEFAULT_STRICT = path.join(__dirname, 'integration-library/registry.yaml');

function parseArgs(argv) {
  const args = { raw: null, strictRegistry: null, json: null, md: null, limit: 25 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--raw') args.raw = argv[++i];
    else if (arg === '--strict-registry') args.strictRegistry = argv[++i];
    else if (arg === '--json') args.json = argv[++i];
    else if (arg === '--md') args.md = argv[++i];
    else if (arg === '--limit') args.limit = Number(argv[++i]);
    else if (arg === '--help') {
      console.log('Usage: node catalog-coverage-dashboard.js [--raw file] [--strict-registry file] [--json out.json] [--md out.md] [--limit 25]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = selector(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function sortedEntries(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function textFor(defs) {
  return defs.map((def) => [def.key, def.displayName, def.description, def.actionLabels && def.actionLabels.type, def.package && def.package.displayName, def.package && def.package.key]
    .filter(Boolean).join(' ')).join(' ').toLowerCase();
}

function packageInfo(defs) {
  const def = defs[0] || {};
  const pkg = def.package || {};
  return {
    id: pkg.id || pkg.key || pkg.displayName || 'unknown_package',
    key: pkg.key || pkg.displayName || pkg.id || 'unknown_package',
    displayName: pkg.displayName || pkg.key || pkg.id || 'Unknown package',
    categories: Array.from(new Set(defs.flatMap((d) => (d.package && d.package.categories) || d.categories || []))).sort(),
  };
}

function classifySafety(key, defs) {
  const t = textFor(defs);
  const pkg = (packageInfo(defs).key || '').toLowerCase();
  if (/validate[-_ ]auth|auth check|test auth|verify auth/.test(t)) return 'safe_auth_check';
  if (/delete|remove|destroy|archive|unsubscribe|block list|global block|pause lead|stop campaign/.test(t)) return 'destructive_external_mutation';
  if (/bulk|batch|sync|export job|import records|audience|campaign|sequence|sequencer|webhook|send message|send email|add lead|create lead|update status/.test(t)) return 'bulk_or_scale_sensitive';
  if (/purchase|credit|paid|actor|apollo|find mobile|phone number/.test(t)) return 'purchase_or_unbounded_cost';
  if (/-source| source |preview|find lists|prospector|search/.test(t)) return 'safe_source_preview';
  if (/create|update|upsert|insert|append|write|push|post to|send |reply|forward/.test(t)) {
    if (/clay|table|row/.test(pkg) || /row|table|workbook|column/.test(t)) return 'clay_internal_write';
    return 'external_write_mutation';
  }
  if (/lookup|count records|pull records|read|get |enrich|find|scrape|extract|check|categorize|complete prompt|generate/.test(t)) {
    if (defs.some((d) => d.auth)) return 'requires_provider_auth';
    return 'safe_read_enrichment';
  }
  return 'unknown_requires_review';
}

function proofStrategyFor(safety) {
  return {
    safe_auth_check: 'provider_auth_probe_then_live',
    safe_source_preview: 'source_preview_only',
    safe_source_materialization_bounded: 'source_materialization_bounded',
    safe_read_enrichment: 'one_row_live_readback',
    requires_provider_auth: 'provider_auth_probe_then_live',
    external_read_lookup: 'controlled_lookup_fixture',
    clay_internal_write: 'controlled_lookup_fixture',
    external_write_mutation: 'external_sandbox_required',
    destructive_external_mutation: 'hitl_destructive_required',
    bulk_or_scale_sensitive: 'hitl_paid_scope_required',
    purchase_or_unbounded_cost: 'hitl_paid_scope_required',
    internal_or_deprecated_candidate: 'excluded_internal_or_deprecated',
    unknown_requires_review: 'blocked_missing_safe_test_data',
  }[safety] || 'blocked_missing_safe_test_data';
}

function catalogStatusFor(safety, strategy) {
  if (strategy === 'excluded_internal_or_deprecated') return 'excluded';
  if (/^hitl_|^blocked_|external_sandbox_required$/.test(strategy)) return 'blocked';
  if (['unknown_requires_review'].includes(safety)) return 'blocked';
  if (['one_row_live_readback', 'provider_auth_probe_then_live', 'source_preview_only', 'controlled_lookup_fixture'].includes(strategy)) return 'proof_queued';
  return 'classified';
}

function loadStrictStatuses(file) {
  if (!file || !fs.existsSync(file)) {
    return { source: null, statuses: { unavailable: 0 }, total: 0 };
  }
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : (parsed.integrations || parsed.actions || parsed.registry || Object.values(parsed.actions || {}));
    const normalized = Array.isArray(records) ? records : [];
    const statuses = countBy(normalized, (record) => record.strictStatus || record.proofStatus || record.status || record.promotionStatus || 'unknown');
    return { source: file, statuses, total: normalized.length };
  }
  // Tiny YAML reader for registry dashboards: understands `integrations: {key: {status}}`.
  // Avoids requiring node_modules in Sandcastle worktrees while preserving deterministic strict-tier counts.
  const records = [];
  let inIntegrations = false;
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^integrations:\s*$/.test(line)) {
      inIntegrations = true;
      continue;
    }
    if (!inIntegrations) continue;
    if (/^[A-Za-z0-9_-]+:\s*$/.test(line)) break;
    const integrationKey = line.match(/^  ([^\s][^:]+):\s*$/);
    if (integrationKey) {
      if (current) records.push(current);
      current = { key: integrationKey[1] };
      continue;
    }
    const field = line.match(/^    (strictStatus|proofStatus|status|promotionStatus):\s*(.+)$/);
    if (current && field) current[field[1]] = field[2].replace(/^['\"]|['\"]$/g, '');
  }
  if (current) records.push(current);
  const statuses = countBy(records, (record) => record.strictStatus || record.proofStatus || record.status || record.promotionStatus || 'unknown');
  return { source: file, statuses, total: records.length };
}

function catalogDateFromPath(file) {
  const match = String(file).match(/runs\/(\d{4}-\d{2}-\d{2})\//);
  return match ? match[1] : 'unknown';
}

function publicSourcePath(file) {
  // Display paths repo-relative; never echo absolute machine paths into reports.
  if (!file) return null;
  const normalized = String(file).replace(/\\/g, '/');
  if (normalized.startsWith(__dirname.replace(/\\/g, '/'))) return path.relative(__dirname, file).replace(/\\/g, '/');
  return path.basename(file);
}

function buildDashboard(options = {}) {
  const rawPath = options.raw || firstExisting([DEFAULT_RAW]);
  if (!rawPath) throw new Error('Raw catalog artifact not found. Pass --raw /path/to/actions-catalog.raw.json');
  const raw = readJson(rawPath);
  const definitions = raw.actions || raw.data || raw;
  if (!Array.isArray(definitions)) throw new Error('Raw catalog must contain an actions array');

  const byKey = new Map();
  for (const def of definitions) {
    if (!def || !def.key) continue;
    if (!byKey.has(def.key)) byKey.set(def.key, []);
    byKey.get(def.key).push(def);
  }

  const records = Array.from(byKey.entries()).map(([key, defs]) => {
    const safety = classifySafety(key, defs);
    const proofStrategy = proofStrategyFor(safety);
    const pkg = packageInfo(defs);
    return {
      key,
      displayName: defs[0].displayName || key,
      package: pkg,
      definitionCount: defs.length,
      safetyClass: safety,
      proofStrategy,
      catalogStatus: catalogStatusFor(safety, proofStrategy),
    };
  }).sort((a, b) => a.package.displayName.localeCompare(b.package.displayName) || a.key.localeCompare(b.key));

  const packageKeys = new Set(definitions.map((def) => {
    const pkg = def.package || {};
    return pkg.id || pkg.key || pkg.displayName || 'unknown_package';
  }));
  const strictRegistry = loadStrictStatuses(options.strictRegistry || firstExisting([DEFAULT_STRICT]));
  const blockedRecords = records.filter((r) => r.catalogStatus === 'blocked');
  const proofable = records.filter((r) => r.catalogStatus === 'proof_queued');

  const blockedByPackage = sortedEntries(countBy(blockedRecords, (r) => r.package.displayName)).slice(0, options.limit || 25)
    .map(([packageName, blockedCount]) => ({ packageName, blockedCount }));

  const nextProofTargets = proofable.slice(0, options.limit || 25).map((r) => ({
    key: r.key,
    packageName: r.package.displayName,
    safetyClass: r.safetyClass,
    proofStrategy: r.proofStrategy,
  }));

  return {
    asOfCatalogDate: catalogDateFromPath(rawPath),
    sources: { rawCatalog: publicSourcePath(rawPath), strictRegistry: publicSourcePath(strictRegistry.source) },
    catalogCoverage: {
      definitionCount: definitions.length,
      uniqueKeyCount: byKey.size,
      packageCount: packageKeys.size,
      safetyDistribution: countBy(records, (r) => r.safetyClass),
      proofStrategyDistribution: countBy(records, (r) => r.proofStrategy),
      catalogStatuses: countBy(records, (r) => r.catalogStatus),
    },
    strictProofCoverage: {
      registryActionCount: strictRegistry.total,
      strictStatuses: strictRegistry.statuses,
      note: 'Strict battle-tested proof coverage is intentionally separate from catalog classification/template/proof-queue coverage.',
    },
    nextProofTargets,
    topBlockedPackages: blockedByPackage,
  };
}

function markdownTable(rows, headers) {
  if (!rows.length) return '_None._\n';
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  return [head, sep, ...rows.map((row) => `| ${headers.map((h) => String(row[h] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n') + '\n';
}

function renderMarkdown(d) {
  const distRows = (counts, countName = 'Count') => sortedEntries(counts).map(([name, count]) => ({ Name: name, [countName]: count }));
  return `# Clay Catalog Coverage Dashboard\n\nCatalog snapshot date: ${d.asOfCatalogDate}\n\n## Catalog coverage (not strict proof)\n\n- Definitions: ${d.catalogCoverage.definitionCount}\n- Unique action keys: ${d.catalogCoverage.uniqueKeyCount}\n- Packages/apps/providers: ${d.catalogCoverage.packageCount}\n\n### Safety distribution\n\n${markdownTable(distRows(d.catalogCoverage.safetyDistribution), ['Name', 'Count'])}\n### Proof strategy distribution\n\n${markdownTable(distRows(d.catalogCoverage.proofStrategyDistribution), ['Name', 'Count'])}\n### Catalog statuses\n\n${markdownTable(distRows(d.catalogCoverage.catalogStatuses), ['Name', 'Count'])}\n## Strict proof coverage (separate tier)\n\n- Registry actions: ${d.strictProofCoverage.registryActionCount}\n- Note: ${d.strictProofCoverage.note}\n\n${markdownTable(distRows(d.strictProofCoverage.strictStatuses), ['Name', 'Count'])}\n## Next proof targets\n\n${markdownTable(d.nextProofTargets.map((r) => ({ Key: r.key, Package: r.packageName, Safety: r.safetyClass, Strategy: r.proofStrategy })), ['Key', 'Package', 'Safety', 'Strategy'])}\n## Top blocked packages\n\n${markdownTable(d.topBlockedPackages.map((r) => ({ Package: r.packageName, Blocked: r.blockedCount })), ['Package', 'Blocked'])}`;
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv);
  const dashboard = buildDashboard(args);
  if (args.json) {
    ensureDir(args.json);
    fs.writeFileSync(args.json, `${JSON.stringify(dashboard, null, 2)}\n`);
  }
  if (args.md) {
    ensureDir(args.md);
    fs.writeFileSync(args.md, renderMarkdown(dashboard));
  }
  if (!args.json && !args.md) console.log(JSON.stringify(dashboard, null, 2));
}

if (require.main === module) main();

module.exports = { buildDashboard, renderMarkdown, classifySafety, proofStrategyFor, DEFAULT_RAW };

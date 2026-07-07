#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const HIGH_VALUE_PACKAGES = [
  { slug: 'cpj', label: 'CPJ', match: ['Companies, People, Jobs'] },
  { slug: 'clay', label: 'Clay', match: ['Clay'] },
  { slug: 'hubspot', label: 'HubSpot', match: ['HubSpot'] },
  { slug: 'salesforce', label: 'Salesforce', match: ['Salesforce'] },
  { slug: 'apollo', label: 'Apollo', match: ['Apollo.io', 'Apollo'] },
  { slug: 'lusha', label: 'Lusha', match: ['Lusha'] },
  { slug: 'pdl', label: 'PDL', match: ['People Data Labs'] },
  { slug: 'google', label: 'Google', match: ['Google'] },
  { slug: 'icypeas', label: 'Icypeas', match: ['Icypeas'] },
  { slug: 'attio', label: 'Attio', match: ['Attio'] },
  { slug: 'snowflake-bigquery', label: 'Snowflake/BigQuery', match: ['Snowflake', 'Google BigQuery'] },
];

const DEFAULT_CATALOG = path.join('runs', '2026-06-09', 'full-integration-audit-shards', 'actions-catalog.raw.json');

function parseArgs(argv) {
  const args = { catalog: null, outDir: path.join('docs', 'package-playbooks'), json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--catalog') args.catalog = argv[++i];
    else if (arg === '--out-dir') args.outDir = argv[++i];
    else if (arg === '--json') args.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function resolveCatalog(explicitPath) {
  const candidates = [explicitPath, DEFAULT_CATALOG].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Catalog not found. Tried: ${candidates.join(', ')}`);
  return found;
}

function cleanText(value) {
  return String(value || '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<redacted-email>')
    .replace(/(api[_ -]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isReviewPackage(packageName, packageKey) {
  return /(^|[^a-z])(test|internal|staging|sandbox|hackathon|legacy)([^a-z]|$)/i.test(`${packageName} ${packageKey}`);
}

function actionText(action) {
  return cleanText([action.key, action.displayName, action.description, action.actionLabels && action.actionLabels.type].join(' ')).toLowerCase();
}

function strategyClass(action) {
  const text = actionText(action);
  if (/validate auth|auth/.test(text)) return 'auth-validation';
  if (/delete|remove/.test(text)) return 'destructive-mutation';
  if (/create|update|upsert|insert|send|write|add to|import|export|sync/.test(text)) return 'external-write-or-sync';
  if (/search|find|lookup|list|retrieve|get|read|fetch/.test(text)) return 'read-or-search';
  if (/enrich|waterfall|email|phone|contact|company|person|people|lead/.test(text)) return 'enrichment';
  if (/query|sql|warehouse|snowflake|bigquery/.test(text)) return 'warehouse-query';
  if (/scrape|crawl|website|browser/.test(text)) return 'scrape-or-web-research';
  if (/ai|prompt|summari|classif|generate|format|normalize|clean/.test(text)) return 'ai-or-transform';
  return 'utility-or-uncategorized';
}

function proofRank(action) {
  const cls = strategyClass(action);
  return {
    'auth-validation': 0,
    'read-or-search': 1,
    'warehouse-query': 2,
    'ai-or-transform': 3,
    'scrape-or-web-research': 4,
    'enrichment': 5,
    'external-write-or-sync': 6,
    'destructive-mutation': 7,
    'utility-or-uncategorized': 8,
  }[cls];
}

function requiredInputs(action) {
  return (action.inputParameterSchema || [])
    .filter((input) => !input.optional)
    .map((input) => cleanText(input.displayName || input.name))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function summarizePackages(actions) {
  const packages = new Map();
  for (const action of actions) {
    const pkg = action.package || {};
    const name = cleanText(pkg.displayName || pkg.key || 'Unknown Package');
    const key = cleanText(pkg.key || name);
    const id = cleanText(pkg.id || '');
    const mapKey = `${name}\u0000${key}`;
    if (!packages.has(mapKey)) {
      packages.set(mapKey, { name, key, id, categories: new Set(), actions: [], review: isReviewPackage(name, key) });
    }
    const rollup = packages.get(mapKey);
    for (const category of [].concat(pkg.categories || [], action.categories || [])) rollup.categories.add(cleanText(category));
    rollup.actions.push(action);
  }
  return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

function matchHighValuePackage(packages, spec) {
  return packages.filter((pkg) => spec.match.some((needle) => pkg.name === needle || pkg.name.toLowerCase().includes(needle.toLowerCase())) && !pkg.review);
}

function packageRollup(pkgs) {
  const actions = pkgs.flatMap((pkg) => pkg.actions);
  const strategies = {};
  const authProviders = new Set();
  const required = new Map();
  const categories = new Set();
  let publicCount = 0;
  for (const pkg of pkgs) for (const category of pkg.categories) categories.add(category);
  for (const action of actions) {
    strategies[strategyClass(action)] = (strategies[strategyClass(action)] || 0) + 1;
    if (action.isPublic) publicCount += 1;
    const provider = cleanText(action.auth && action.auth.providerType);
    if (provider) authProviders.add(provider);
    for (const input of requiredInputs(action)) required.set(input, (required.get(input) || 0) + 1);
  }
  return {
    actions: actions.sort((a, b) => cleanText(a.key).localeCompare(cleanText(b.key)) || Number(a.version || 0) - Number(b.version || 0)),
    categories: [...categories].sort(),
    strategies: Object.fromEntries(Object.entries(strategies).sort(([a], [b]) => a.localeCompare(b))),
    authProviders: [...authProviders].sort(),
    requiredInputs: [...required.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12),
    publicCount,
  };
}

function riskBullets(rollup) {
  const risks = ['Catalog coverage only: this skeleton is not strict battle-tested proof.'];
  if (rollup.authProviders.length) risks.push('Requires Clay app auth; account IDs/tokens are not portable and must stay redacted.');
  if (rollup.strategies['external-write-or-sync']) risks.push('Contains external write/sync actions; prove only against sandbox records with explicit confirmation.');
  if (rollup.strategies['destructive-mutation']) risks.push('Contains destructive actions; keep blocked until a reversible sandbox plan exists.');
  if (rollup.strategies.enrichment) risks.push('May spend enrichment credits or call third-party data providers; start with one row.');
  if (rollup.strategies['warehouse-query']) risks.push('Warehouse actions can scan data or expose query results; use least-privilege sample datasets.');
  return risks;
}

function blockers(rollup) {
  const blockers = ['No live Clay proof captured for these actions in this generated skeleton.'];
  if (rollup.authProviders.length) blockers.push('Need a confirmed test auth account and redacted readback evidence.');
  if (rollup.strategies['external-write-or-sync'] || rollup.strategies['destructive-mutation']) blockers.push('Need an isolated sandbox destination before mutating proof.');
  return blockers;
}

function renderPackagePlaybook(spec, pkgs) {
  const rollup = packageRollup(pkgs);
  const packageNames = pkgs.map((pkg) => `${pkg.name} (${pkg.key})`).sort();
  const proofActions = [...rollup.actions].sort((a, b) => proofRank(a) - proofRank(b) || cleanText(a.key).localeCompare(cleanText(b.key))).slice(0, 20);
  const lines = [];
  lines.push(`# ${spec.label} package playbook skeleton`, '');
  lines.push('> Generated from the Clay action catalog. This is catalog coverage, not strict battle-tested proof.', '');
  lines.push('## Package overview', '');
  lines.push(`- Packages: ${packageNames.join('; ')}`);
  lines.push(`- Catalog actions: ${rollup.actions.length}`);
  lines.push(`- Public actions in catalog: ${rollup.publicCount}`);
  lines.push(`- Categories: ${rollup.categories.length ? rollup.categories.join(', ') : 'none in catalog'}`);
  lines.push('', '### Strategy class rollup', '');
  for (const [strategy, count] of Object.entries(rollup.strategies)) lines.push(`- ${strategy}: ${count}`);
  lines.push('', '## Auth prerequisites', '');
  if (rollup.authProviders.length) for (const provider of rollup.authProviders) lines.push(`- Clay app auth provider: \`${provider}\` (use redacted test account only).`);
  else lines.push('- No explicit auth provider in catalog; verify in UI before proof.');
  lines.push('', '## Example input needs', '');
  if (rollup.requiredInputs.length) for (const [input, count] of rollup.requiredInputs) lines.push(`- ${input} (${count} actions)`);
  else lines.push('- No required inputs listed in catalog.');
  lines.push('', '## Safe proof order', '');
  lines.push('1. Validate auth/readiness actions only; capture redacted readback.');
  lines.push('2. Run read/search/query actions on one known-safe row or fixture.');
  lines.push('3. Run enrichment/AI/transform actions on one row with non-sensitive sample data.');
  lines.push('4. Run external-write/sync actions only against sandbox destinations after exact-command confirmation.');
  lines.push('5. Keep destructive actions blocked unless a reversible sandbox deletion fixture is approved.');
  lines.push('', 'Suggested first catalog actions:');
  for (const action of proofActions) lines.push(`- ${cleanText(action.key)} v${action.version || 1} — ${cleanText(action.displayName)} (${strategyClass(action)})`);
  lines.push('', '## Action list', '');
  lines.push('| Action key | Display name | Strategy class | Required inputs | Public |');
  lines.push('|---|---|---|---|---|');
  for (const action of rollup.actions) {
    const req = requiredInputs(action).join(', ') || 'none';
    lines.push(`| ${cleanText(action.key)} | ${cleanText(action.displayName)} | ${strategyClass(action)} | ${req} | ${action.isPublic ? 'yes' : 'no'} |`);
  }
  lines.push('', '## Risks', '');
  for (const risk of riskBullets(rollup)) lines.push(`- ${risk}`);
  lines.push('', '## Blockers before strict proof', '');
  for (const blocker of blockers(rollup)) lines.push(`- ${blocker}`);
  lines.push('');
  return lines.join('\n');
}

function renderIndex(generated, reviewPackages) {
  const lines = ['# Clay package playbook skeleton index', '', '> Deterministically generated from the Clay action catalog. These files are not live proof.', '', '## Prioritized high-value packages', ''];
  for (const item of generated) lines.push(`- [${item.label}](${item.file}) — ${item.actionCount} catalog actions`);
  lines.push('', '## Internal/test packages flagged for review', '');
  if (reviewPackages.length === 0) lines.push('- None detected.');
  else for (const pkg of reviewPackages) lines.push(`- ${pkg.name} (${pkg.key}) — ${pkg.actions.length} actions`);
  lines.push('');
  return lines.join('\n');
}

function generate(catalogPath, outDir) {
  const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const packages = summarizePackages(raw.actions || []);
  fs.mkdirSync(outDir, { recursive: true });
  const generated = [];
  for (const spec of HIGH_VALUE_PACKAGES) {
    const pkgs = matchHighValuePackage(packages, spec);
    if (!pkgs.length) continue;
    const file = `${spec.slug}.md`;
    fs.writeFileSync(path.join(outDir, file), renderPackagePlaybook(spec, pkgs));
    generated.push({ label: spec.label, file, actionCount: pkgs.reduce((sum, pkg) => sum + pkg.actions.length, 0) });
  }
  const reviewPackages = packages.filter((pkg) => pkg.review);
  fs.writeFileSync(path.join(outDir, 'README.md'), renderIndex(generated, reviewPackages));
  return { catalogPath, outDir, generated, reviewPackageCount: reviewPackages.length };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    const catalogPath = resolveCatalog(args.catalog);
    const result = generate(catalogPath, args.outDir);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Generated ${result.generated.length} package playbook skeletons in ${result.outDir}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { HIGH_VALUE_PACKAGES, generate, renderPackagePlaybook, summarizePackages, strategyClass, isReviewPackage };

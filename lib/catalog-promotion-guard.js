#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
function loadYaml() {
  try {
    return require('yaml');
  } catch (err) {
    err.message = 'YAML support requires npm dependencies: ' + err.message;
    throw err;
  }
}

function readData(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (/\.ya?ml$/i.test(file)) return loadYaml().parse(text) || {};
  return JSON.parse(text);
}

function writeData(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (/\.ya?ml$/i.test(file)) fs.writeFileSync(file, loadYaml().stringify(data));
  else fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function catalogActions(catalog) {
  if (Array.isArray(catalog)) return catalog;
  if (Array.isArray(catalog.actions)) return catalog.actions;
  if (catalog.catalog && Array.isArray(catalog.catalog.actions)) return catalog.catalog.actions;
  return [];
}

function findCatalogAction(catalog, key) {
  return catalogActions(catalog).find(action => action && action.key === key) || null;
}

function registryEntries(registry) {
  if (Array.isArray(registry)) return registry;
  if (Array.isArray(registry.entries)) return registry.entries;
  if (Array.isArray(registry.actions)) return registry.actions;
  if (registry.entries && typeof registry.entries === 'object') return Object.values(registry.entries);
  if (registry.actions && typeof registry.actions === 'object') return Object.values(registry.actions);
  return [];
}

function registryHasKey(registry, key) {
  return registryEntries(registry).some(entry => entry && entry.key === key);
}

function isNonEmpty(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function getPath(obj, paths) {
  for (const p of paths) {
    const value = p.split('.').reduce((cur, part) => (cur && cur[part] !== undefined ? cur[part] : undefined), obj);
    if (value !== undefined) return value;
  }
  return undefined;
}

function listUnresolved(errors) {
  if (!errors) return [];
  const items = Array.isArray(errors) ? errors : Object.values(errors).flat();
  return items.filter(item => {
    if (!item) return false;
    if (typeof item === 'string') return item.trim().length > 0;
    return item.resolved !== true && item.status !== 'resolved' && item.status !== 'ignored';
  });
}

function proofFailures(proof = {}) {
  const failures = [];
  const parentFullValue = getPath(proof, ['parentFullValue', 'parent.fullValue', 'evidence.parentFullValue', 'parent.externalContent.fullValue']);
  if (!isNonEmpty(parentFullValue)) failures.push('parent_fullValue_required');

  const outputs = getPath(proof, ['extractedOutputs', 'outputs', 'evidence.extractedOutputs']);
  if (!Array.isArray(outputs) || outputs.length === 0) failures.push('extracted_outputs_required');
  else if (!outputs.every(o => isNonEmpty(o && (o.value !== undefined ? o.value : o.path || o.name || o.key)))) failures.push('extracted_outputs_must_have_values_or_paths');

  const valueQa = getPath(proof, ['valueQa', 'valueQA', 'qa', 'evidence.valueQa']);
  const qaPass = valueQa === true || (valueQa && (valueQa.passed === true || valueQa.status === 'pass' || valueQa.status === 'passed'));
  if (!qaPass) failures.push('value_qa_must_pass');

  const statusSemantics = getPath(proof, ['statusSemantics', 'semantics.status', 'evidence.statusSemantics']);
  if (!isNonEmpty(statusSemantics)) failures.push('status_semantics_required');

  const unresolvedRuntime = listUnresolved(getPath(proof, ['runtimeErrors', 'errors.runtime', 'evidence.runtimeErrors']));
  if (unresolvedRuntime.length) failures.push('unresolved_runtime_errors');
  const unresolvedSettings = listUnresolved(getPath(proof, ['settingsErrors', 'errors.settings', 'evidence.settingsErrors']));
  if (unresolvedSettings.length) failures.push('unresolved_settings_errors');

  if (proof.status && ['catalog', 'template-only', 'template_only', 'discovered'].includes(String(proof.status))) failures.push('catalog_or_template_only_state_is_not_strict_proof');
  return failures;
}

function buildPromotionProposal({ catalog, registry = {}, key, proof = {} }) {
  if (!key) throw new Error('key is required');
  const action = findCatalogAction(catalog, key);
  if (!action) return { ok: false, key, failures: ['catalog_key_not_found'] };
  const failures = proofFailures(proof);
  return {
    ok: failures.length === 0,
    key,
    failures,
    alreadyRegistered: registryHasKey(registry, key),
    catalogEntry: {
      key: action.key,
      version: action.version,
      packageId: action.package && action.package.id,
      packageKey: action.package && action.package.key,
      displayName: action.displayName,
    },
  };
}

function promoteCatalogKey({ catalog, registry = {}, key, proof = {} }) {
  const proposal = buildPromotionProposal({ catalog, registry, key, proof });
  if (!proposal.ok) {
    const err = new Error(`promotion rejected for ${key}: ${proposal.failures.join(', ')}`);
    err.proposal = proposal;
    throw err;
  }
  if (proposal.alreadyRegistered) return { registry, proposal, promoted: false };
  const entry = {
    ...proposal.catalogEntry,
    status: 'battle-tested',
    strictProof: {
      parentFullValue: true,
      extractedOutputs: true,
      valueQa: true,
      statusSemantics: proof.statusSemantics || proof.evidence?.statusSemantics,
      unresolvedRuntimeErrors: 0,
      unresolvedSettingsErrors: 0,
    },
  };
  let next;
  if (Array.isArray(registry)) next = [...registry, entry];
  else if (Array.isArray(registry.entries)) next = { ...registry, entries: [...registry.entries, entry] };
  else if (Array.isArray(registry.actions)) next = { ...registry, actions: [...registry.actions, entry] };
  else if (registry.entries && typeof registry.entries === 'object') next = { ...registry, entries: { ...registry.entries, [key]: entry } };
  else if (registry.actions && typeof registry.actions === 'object') next = { ...registry, actions: { ...registry.actions, [key]: entry } };
  else next = { ...registry, entries: [entry] };
  return { registry: next, proposal, promoted: true };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      args[k] = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    } else args._.push(a);
  }
  return args;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cmd = flags._[0];
  if (!cmd || !['propose', 'promote'].includes(cmd)) {
    console.error('usage: catalog-promotion-guard propose|promote --catalog catalog.json --registry registry.yaml --key action-key --proof proof.json [--out registry.yaml]');
    process.exit(2);
  }
  const catalog = readData(flags.catalog);
  const registry = flags.registry && fs.existsSync(flags.registry) ? readData(flags.registry) : {};
  const proof = flags.proof ? readData(flags.proof) : {};
  if (cmd === 'propose') {
    console.log(JSON.stringify(buildPromotionProposal({ catalog, registry, key: flags.key, proof }), null, 2));
    return;
  }
  const result = promoteCatalogKey({ catalog, registry, key: flags.key, proof });
  if (flags.out) writeData(flags.out, result.registry);
  console.log(JSON.stringify({ promoted: result.promoted, proposal: result.proposal, out: flags.out || null }, null, 2));
}

if (require.main === module) main();

module.exports = {
  buildPromotionProposal,
  promoteCatalogKey,
  proofFailures,
};

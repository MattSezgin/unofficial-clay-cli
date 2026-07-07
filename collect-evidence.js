#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { buildEvidenceBundleProvenance } = require('./provenance');

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

function readStructured(file) {
  if (!file) return null;
  const text = fs.readFileSync(file, 'utf8');
  if (/\.ya?ml$/i.test(file)) return YAML.parse(text);
  return JSON.parse(text);
}

function writeStructured(data, file) {
  const text = /\.json$/i.test(file) ? JSON.stringify(data, null, 2) + '\n' : YAML.stringify(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { wrote: file, bytes: Buffer.byteLength(text) };
}

function parseCounts(value) {
  if (!value) return {};
  if (fs.existsSync(value)) return readStructured(value);
  return Object.fromEntries(String(value).split(',').filter(Boolean).map(pair => {
    const [key, raw] = pair.split('=');
    const num = Number(raw);
    return [key, Number.isFinite(num) ? num : raw];
  }));
}

function manifestRecordCount(manifest) {
  if (!manifest) return null;
  if (Array.isArray(manifest.records)) return manifest.records.length;
  if (Array.isArray(manifest.results)) return manifest.results.length;
  return null;
}

function deriveFirstRunGatePassed(verifyResult, counts, manifest) {
  if (counts.firstRunGatePassed !== undefined) return counts.firstRunGatePassed === true || counts.firstRunGatePassed === 'true';
  const errorCount = counts.errorCount ?? verifyResult?.issueCount ?? verifyResult?.issues?.length;
  const rowsTested = counts.rowsTested ?? manifestRecordCount(manifest);
  if (errorCount === undefined || errorCount === null || rowsTested === undefined || rowsTested === null) return null;
  return Number(errorCount) === 0 && Number(rowsTested) > 0;
}

function commandFromArtifact(artifact, fallbackId) {
  const provenance = artifact?.provenance || {};
  if (provenance.kind === 'clay-command') {
    return {
      commandId: provenance.commandId || fallbackId,
      exactCommand: provenance.exactCommand || null,
      exitCode: provenance.exitCode,
      provenanceKind: provenance.kind,
    };
  }
  return null;
}

function buildEvidence(flags) {
  const applyResult = readStructured(flags.apply);
  const preflight = readStructured(flags.preflight);
  const hydratedPreflight = readStructured(flags['hydrated-preflight']);
  const verifyResult = readStructured(flags.verify);
  const manifest = readStructured(flags.manifest);
  const counts = parseCounts(flags.counts);

  if (manifest && counts.rowsTested === undefined) {
    const count = manifestRecordCount(manifest);
    if (count !== null) counts.rowsTested = count;
  }
  if (verifyResult && counts.errorCount === undefined && verifyResult.issueCount !== undefined) counts.errorCount = verifyResult.issueCount;

  const tableId = flags.table || applyResult?.tableId || manifest?.table?.id || null;
  const viewId = flags.view || applyResult?.viewId || null;
  const firstRunGatePassed = deriveFirstRunGatePassed(verifyResult, counts, manifest);
  const recommendation = flags.recommendation || (firstRunGatePassed === true ? 'continue' : firstRunGatePassed === false ? 'revise' : undefined);
  const sourceFiles = [
    flags.apply,
    flags.preflight,
    flags['hydrated-preflight'],
    flags.verify,
    flags.manifest,
  ].filter(Boolean);
  const sourceCommands = [
    commandFromArtifact(applyResult, 'apply_sample_spec'),
    ...(preflight?.liveCommands || []).map(command => ({ commandId: command.id, exactCommand: command.command, exitCode: null, provenanceKind: null })),
    ...(hydratedPreflight?.liveCommands || []).map(command => ({ commandId: command.id, exactCommand: command.command, exitCode: null, provenanceKind: null })),
  ].filter(command => command && command.exactCommand);

  return {
    provenance: buildEvidenceBundleProvenance({
      sourceFiles,
      sourceCommands,
      tableId,
      viewId,
      workspaceId: flags.workspace || applyResult?.provenance?.workspaceId || null,
      folderId: flags.folder || applyResult?.provenance?.folderId || null,
      workbookId: flags.workbook || applyResult?.provenance?.workbookId || null,
    }),
    applyResult: applyResult || undefined,
    preflight: preflight || undefined,
    hydratedPreflight: hydratedPreflight || undefined,
    verifyResult: verifyResult || undefined,
    manifest: manifest || undefined,
    tableId,
    viewId,
    counts,
    redactedManifestPath: flags['redacted-manifest'] || flags.manifest || undefined,
    fullJsonSamplePath: flags['full-json-sample'] || undefined,
    verificationCommand: flags['verification-command'] || (tableId ? `node clay-v2.js verify-table ${tableId}${viewId ? ` --view ${viewId}` : ''} --include-rows 10` : undefined),
    firstRunGatePassed,
    qualityReportReviewed: flags['quality-reviewed'] === 'true' ? true : flags['quality-reviewed'] === 'false' ? false : undefined,
    recommendation,
    reason: flags.reason || (recommendation === 'continue' ? 'Collected evidence has no reported verifier errors.' : undefined),
    requiredFixesBeforeScale: flags['required-fixes'] || undefined,
    secondConfirmationReceivedForScale: false,
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log('Usage: node collect-evidence.js [--apply apply.json] [--preflight preflight.json] [--hydrated-preflight preflight.json] [--verify verify.json] [--manifest manifest.json] [--counts rowsTested=10,errorCount=0] [--workspace ID --folder ID --workbook ID] [--out evidence.json]');
    return;
  }

  const evidence = buildEvidence(flags);
  if (flags.out) {
    console.log(JSON.stringify(writeStructured(evidence, flags.out), null, 2));
    return;
  }
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = {
  buildEvidence,
  deriveFirstRunGatePassed,
  manifestRecordCount,
  parseArgs,
  parseCounts,
  readStructured,
  writeStructured,
};

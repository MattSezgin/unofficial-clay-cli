#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { parseArgs, readStructured: readPlanStructured, writeStructured } = require('./plan-playbook');
const { hydratePacket } = require('./hydrate-sample-run');
const { buildPreflight } = require('./preflight-sample-run');
const { buildEvidence } = require('./collect-evidence');
const { renderReport } = require('./quality-report');

function readStructured(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (/\.ya?ml$/i.test(file)) return YAML.parse(text);
  return JSON.parse(text);
}

function resolveToolPath(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.join(__dirname, '..', file);
}

function relativeToolPath(file) {
  return path.relative(path.join(__dirname, '..'), file);
}

function writeJson(data, file) {
  writeStructured(data, file);
  return relativeToolPath(file);
}

function writeText(text, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return relativeToolPath(file);
}

function hasEvidenceInputs(opts = {}) {
  return !!(opts.verify || opts.manifest || opts.counts || opts.recommendation || opts.reason);
}

function buildAdvance(preparedFile, opts = {}) {
  const preparedPath = resolveToolPath(preparedFile);
  const prepared = readStructured(preparedPath);
  if (prepared.mode !== 'offline-prepared-sample-run') {
    throw new Error('advance requires an offline-prepared-sample-run artifact');
  }
  if (!prepared.artifacts?.sampleRunPacket) {
    throw new Error('prepared artifact does not include sampleRunPacket; resolve intake/input issues first');
  }
  const playbookId = prepared.selectedPlaybook?.id || 'sample-run';
  const outDir = opts.outDir ? path.resolve(opts.outDir) : path.dirname(preparedPath);
  fs.mkdirSync(outDir, { recursive: true });

  const samplePacketPath = resolveToolPath(prepared.artifacts.sampleRunPacket);
  const planPath = resolveToolPath(prepared.artifacts.plan);
  const originalPacket = readStructured(samplePacketPath);
  const plan = readPlanStructured(planPath);

  const hydrated = hydratePacket(originalPacket, {
    'apply-result': opts.applyResult ? path.resolve(opts.applyResult) : null,
    table: opts.table,
    view: opts.view,
    completed: opts.completed || 'apply_sample_spec',
  });
  const hydratedPath = path.join(outDir, `${playbookId}-hydrated-sample-run.json`);
  const hydratedRel = writeJson(hydrated, hydratedPath);

  const preflight = buildPreflight(hydrated, {
    config: opts.config ? path.resolve(opts.config) : null,
    profile: opts.profile,
    workspace: opts.workspace,
    folder: opts.folder,
    workbook: opts.workbook,
  });
  const preflightPath = path.join(outDir, `${playbookId}-hydrated-preflight.json`);
  const preflightRel = writeJson(preflight, preflightPath);

  const artifacts = {
    prepared: relativeToolPath(preparedPath),
    sampleRunPacket: relativeToolPath(samplePacketPath),
    hydratedSampleRunPacket: hydratedRel,
    hydratedPreflight: preflightRel,
  };

  let evidence = null;
  let reportPath = null;
  if (hasEvidenceInputs(opts)) {
    evidence = buildEvidence({
      apply: opts.applyResult ? path.resolve(opts.applyResult) : undefined,
      preflight: resolveToolPath(prepared.artifacts.preflight),
      'hydrated-preflight': preflightPath,
      verify: opts.verify ? path.resolve(opts.verify) : undefined,
      manifest: opts.manifest ? path.resolve(opts.manifest) : undefined,
      counts: opts.counts,
      table: opts.table,
      view: opts.view,
      recommendation: opts.recommendation,
      reason: opts.reason,
      'quality-reviewed': opts['quality-reviewed'],
      'required-fixes': opts['required-fixes'],
      'redacted-manifest': opts['redacted-manifest'],
      'full-json-sample': opts['full-json-sample'],
    });
    const evidencePath = path.join(outDir, `${playbookId}-evidence.json`);
    artifacts.evidence = writeJson(evidence, evidencePath);

    const report = renderReport(plan, { evidence });
    reportPath = path.join(outDir, `${playbookId}-quality-report.md`);
    artifacts.qualityReport = writeText(report, reportPath);
  }

  const nextLiveCommand = (preflight.liveCommands || [])[0] || null;
  const readyForNextLiveCommand = !!preflight.readiness?.readyForFirstLiveCommand;
  const issues = [];
  if (!readyForNextLiveCommand) {
    issues.push({
      severity: 'error',
      type: 'next_live_command_not_ready',
      missingRuntime: preflight.readiness?.missingRuntime || [],
      unresolvedCommands: preflight.readiness?.unresolvedCommands || [],
      workspaceCheck: preflight.readiness?.workspaceCheck || null,
      profileCheck: preflight.readiness?.profileCheck || null,
    });
  }
  if (evidence && evidence.firstRunGatePassed === false) {
    issues.push({ severity: 'error', type: 'first_run_gate_failed', recommendation: evidence.recommendation || 'revise' });
  }

  const manifest = {
    artifactVersion: 1,
    mode: 'offline-advanced-sample-run',
    generatedAt: new Date().toISOString(),
    selectedPlaybook: prepared.selectedPlaybook,
    completedLiveCommandIds: hydrated.hydration?.completedLiveCommandIds || [],
    hydration: hydrated.hydration,
    readiness: {
      status: readyForNextLiveCommand ? 'ready_for_next_live_command_confirmation' : 'not_ready',
      readyForNextLiveCommand,
      nextLiveCommandId: nextLiveCommand?.id || null,
      nextLiveCommand: nextLiveCommand?.command || null,
      preflight: preflight.readiness,
      firstRunGatePassed: evidence?.firstRunGatePassed ?? null,
      recommendation: evidence?.recommendation || null,
    },
    artifacts,
    issues,
    nextAction: readyForNextLiveCommand
      ? `Ask for exact chat confirmation before running ${nextLiveCommand.id}.`
      : 'Resolve preflight/evidence issues before asking for another live Clay command confirmation.',
    hardRules: [
      'No live Clay command may run from this artifact without exact chat confirmation.',
      'Scale still requires a second explicit confirmation after first-run evidence and quality report review.',
    ],
  };

  const manifestPath = path.join(outDir, `${playbookId}-advanced-sample-run.json`);
  artifacts.manifest = relativeToolPath(manifestPath);
  writeStructured(manifest, manifestPath);
  return manifest;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const prepared = flags.prepared || flags._[0];
  if (!prepared || flags.help) {
    console.log('Usage: node lib/advance-sample-run.js --prepared runs/.../prepared-sample-run.json --apply-result apply.json [--config config.yaml --profile NAME --workspace WORKSPACE_ID --folder FOLDER --workbook WORKBOOK] [--verify verify.json --manifest manifest.json --counts rowsTested=10,errorCount=0] [--out-dir runs/.../] [--json]');
    return;
  }

  const manifest = buildAdvance(prepared, {
    applyResult: flags['apply-result'],
    table: flags.table,
    view: flags.view,
    completed: flags.completed,
    config: flags.config,
    profile: flags.profile,
    workspace: flags.workspace,
    folder: flags.folder,
    workbook: flags.workbook,
    verify: flags.verify,
    manifest: flags.manifest,
    counts: flags.counts,
    recommendation: flags.recommendation,
    reason: flags.reason,
    'quality-reviewed': flags['quality-reviewed'],
    'required-fixes': flags['required-fixes'],
    'redacted-manifest': flags['redacted-manifest'],
    'full-json-sample': flags['full-json-sample'],
    outDir: flags['out-dir'],
  });

  if (flags.json) process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
  else process.stdout.write(YAML.stringify(manifest));
}

if (require.main === module) main();

module.exports = {
  buildAdvance,
  hasEvidenceInputs,
  resolveToolPath,
};

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { parseArgs, writeStructured } = require('./plan-playbook');
const { buildPreparation } = require('./prepare-sample-run');
const { buildAdvance } = require('./advance-sample-run');
const { buildScaleGate } = require('./scale-gate');
const { buildCommandProvenance } = require('./provenance');

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return file;
}

function relativeToolPath(file) {
  return path.relative(__dirname, file);
}

function defaultScaleCommand(tableId, viewId, field) {
  return `node clay-v2.js run-top ${tableId} --field "${field}" --view ${viewId} --n 100 --confirm`;
}

function buildSimulation(opts = {}) {
  const request = opts.request || 'Build a campaign personalization table for cold email with opener angles.';
  const playbookHint = opts.playbook || 'outbound-personalization';
  const outDir = ensureDir(opts.outDir || path.join(__dirname, 'runs', todayStamp(), `${playbookHint}-simulation`));
  const tableId = opts.table || 't_SIMULATED_SAMPLE_TABLE';
  const viewId = opts.view || 'gv_SIMULATED_SAMPLE_VIEW';
  const rowsTested = Number(opts.rows || 10);
  const readyCount = Number(opts.ready || Math.max(rowsTested - 2, 0));
  const actionField = opts.field || 'AI Personalization';

  const prepared = buildPreparation(request, {
    inputs: opts.inputs,
    config: opts.config,
    profile: opts.profile,
    workspace: opts.workspace || 'TEST_WS',
    folder: opts.folder || 'f_SIMULATED_FOLDER',
    workbook: opts.workbook || 'wb_SIMULATED_WORKBOOK',
    outDir,
  });
  const preparedPath = path.join(__dirname, prepared.artifacts.manifest);
  prepared.simulated = true;
  prepared.warning = 'Prepared by offline-full-loop-simulation with fake runtime artifacts. This is not live Clay proof.';
  writeStructured(prepared, preparedPath);

  const applyPath = writeJson(path.join(outDir, `${prepared.selectedPlaybook.id}-simulated-apply-result.json`), {
    simulated: true,
    applied: true,
    tableId,
    viewId,
    operations: [
      { op: 'create_table', id: tableId },
      { op: 'create_view', id: viewId },
    ],
    provenance: buildCommandProvenance({
      commandId: 'apply_sample_spec',
      exactCommand: `node clay-v2.js apply-spec ${prepared.artifacts.plan || 'sample-plan.json'} --workspace ${opts.workspace || 'TEST_WS'} --workbook ${opts.workbook || 'wb_SIMULATED_WORKBOOK'} --confirm`,
      exitCode: 0,
      workspaceId: opts.workspace || 'TEST_WS',
      folderId: opts.folder || 'f_SIMULATED_FOLDER',
      workbookId: opts.workbook || 'wb_SIMULATED_WORKBOOK',
      tableId,
      viewId,
    }),
  });
  const verifyPath = writeJson(path.join(outDir, `${prepared.selectedPlaybook.id}-simulated-verify.json`), {
    simulated: true,
    valid: true,
    issueCount: 0,
    issues: [],
  });
  const manifestPath = writeJson(path.join(outDir, `${prepared.selectedPlaybook.id}-simulated-manifest.json`), {
    simulated: true,
    table: { id: tableId },
    records: Array.from({ length: rowsTested }, (_, index) => ({ id: `r_SIMULATED_${index + 1}` })),
  });

  const advanced = buildAdvance(preparedPath, {
    applyResult: applyPath,
    config: opts.config,
    profile: opts.profile,
    workspace: opts.workspace || 'TEST_WS',
    folder: opts.folder || 'f_SIMULATED_FOLDER',
    workbook: opts.workbook || 'wb_SIMULATED_WORKBOOK',
    verify: verifyPath,
    manifest: manifestPath,
    counts: `rowsTested=${rowsTested},successCount=${rowsTested},errorCount=0,readyCount=${readyCount},creditConsumingFieldsRun=1`,
    recommendation: 'continue',
    reason: 'Simulated fixture: verifier issue count is zero and sample count is present.',
    'quality-reviewed': 'true',
    'required-fixes': 'none in simulated fixture',
    outDir,
  });
  const advancedPath = path.join(__dirname, advanced.artifacts.manifest);
  advanced.simulated = true;
  advanced.warning = 'Advanced by offline-full-loop-simulation with fake apply/readback evidence. This is not live Clay proof.';
  writeStructured(advanced, advancedPath);
  if (advanced.artifacts.qualityReport) {
    const reportPath = path.join(__dirname, advanced.artifacts.qualityReport);
    fs.appendFileSync(reportPath, '\nSimulation warning: fake evidence only; this report does not prove a live Clay workflow worked.\n');
  }

  const parityPath = writeJson(path.join(outDir, `${prepared.selectedPlaybook.id}-simulated-workbook-parity.json`), {
    simulated: true,
    kind: 'clay-workbook-parity-audit',
    status: 'workbook_parity_complete',
    workbookId: opts.workbook || 'wb_SIMULATED_WORKBOOK',
    workspaceId: opts.workspace || 'TEST_WS',
    summary: {
      tableCount: 1,
      actionCount: 3,
      formulaCount: 6,
      viewCount: 3,
      providerActionCount: 1,
      httpActionCount: 1,
      promptedActionCount: 1,
      jsonSchemaActionCount: 1,
      runConditionActionCount: 3,
      tablesWithRows: 1,
    },
    missing: [],
    recommendation: 'continue',
    warning: 'Simulated parity artifact for control-plane tests only; this is not live Clay workbook proof.',
  });

  const scaleCommand = opts.command || defaultScaleCommand(tableId, viewId, actionField);
  const scaleGate = buildScaleGate({
    plan: path.join(__dirname, prepared.artifacts.plan),
    evidence: path.join(__dirname, advanced.artifacts.evidence),
    'workbook-parity': parityPath,
    command: scaleCommand,
    'quality-reviewed': 'true',
  });
  scaleGate.simulated = true;
  scaleGate.warning = 'Scale gate generated from fake simulation evidence. This cannot authorize live scale.';
  const scaleGatePath = path.join(outDir, `${prepared.selectedPlaybook.id}-simulated-scale-gate.json`);
  writeStructured(scaleGate, scaleGatePath);

  const simulation = {
    artifactVersion: 1,
    mode: 'offline-full-loop-simulation',
    generatedAt: new Date().toISOString(),
    simulated: true,
    warning: 'This is fake evidence for exercising the control plane only. It does not prove a live Clay workflow worked.',
    selectedPlaybook: prepared.selectedPlaybook,
    readiness: {
      prepared: prepared.readiness.status,
      advanced: advanced.readiness.status,
      scaleGate: scaleGate.readiness.status,
      fullOfflineLoopReady: prepared.readiness.readyForFirstLiveCommand
        && advanced.readiness.readyForNextLiveCommand
        && scaleGate.readiness.readyForScaleConfirmation,
    },
    artifacts: {
      prepared: prepared.artifacts.manifest,
      simulatedApplyResult: relativeToolPath(applyPath),
      simulatedVerify: relativeToolPath(verifyPath),
      simulatedManifest: relativeToolPath(manifestPath),
      advanced: advanced.artifacts.manifest,
      evidence: advanced.artifacts.evidence,
      qualityReport: advanced.artifacts.qualityReport,
      workbookParity: relativeToolPath(parityPath),
      scaleGate: relativeToolPath(scaleGatePath),
    },
    nextLiveSequence: [
      'Run prepare-sample-run.js with real inputs/workbook.',
      'Ask for exact confirmation on apply_sample_spec.',
      'Save the real apply result.',
      'Run advance-sample-run.js with the real apply result.',
      'Ask for exact confirmation on the next first-10 run command.',
      'Collect real verify/manifest/count artifacts.',
      'Review the real quality report.',
      'Run workbook-parity.js against the live workbook fixture.',
      'Run scale-gate.js with --workbook-parity and ask for second confirmation using its confirmationPrompt.',
    ],
  };

  const simulationPath = path.join(outDir, `${prepared.selectedPlaybook.id}-full-loop-simulation.json`);
  writeStructured(simulation, simulationPath);
  simulation.artifacts.simulation = relativeToolPath(simulationPath);
  writeStructured(simulation, simulationPath);
  return simulation;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log('Usage: node simulate-full-loop.js --request "Build a campaign personalization table" --inputs examples/outbound-personalization-input.example.yaml --config config.example.yaml --profile yourTestProfile [--out-dir runs/<date>/simulation] [--json]');
    return;
  }

  const simulation = buildSimulation({
    request: flags.request || flags._.join(' '),
    playbook: flags.playbook,
    inputs: flags.inputs ? path.resolve(flags.inputs) : path.join(__dirname, 'examples', 'outbound-personalization-input.example.yaml'),
    config: flags.config ? path.resolve(flags.config) : path.join(__dirname, 'config.example.yaml'),
    profile: flags.profile || 'yourTestProfile',
    workspace: flags.workspace,
    folder: flags.folder,
    workbook: flags.workbook,
    table: flags.table,
    view: flags.view,
    field: flags.field,
    rows: flags.rows,
    ready: flags.ready,
    command: flags.command,
    outDir: flags['out-dir'] ? path.resolve(flags['out-dir']) : null,
  });

  if (flags.json) process.stdout.write(JSON.stringify(simulation, null, 2) + '\n');
  else process.stdout.write(YAML.stringify(simulation));
}

if (require.main === module) main();

module.exports = {
  buildSimulation,
  defaultScaleCommand,
};

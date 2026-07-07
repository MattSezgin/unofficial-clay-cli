#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  buildSampleRunPacketArtifact,
  buildPlan,
  formatStructured,
  parseArgs,
  readStructured,
  writeStructured,
} = require('./plan-playbook');
const { buildIntake } = require('./intake-request');
const { buildPreflight } = require('./preflight-sample-run');
const { loadConfigProfile } = require('./validate-config');

function readMaybeFile(value) {
  if (!value) return '';
  const maybePath = path.resolve(String(value));
  if (fs.existsSync(maybePath) && fs.statSync(maybePath).isFile()) return fs.readFileSync(maybePath, 'utf8');
  return String(value);
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function selectTemplate(intake, selector) {
  if (selector) return selector;
  const first = intake.routing.selectedPlaybook.specTemplates[0];
  return first ? path.basename(first) : null;
}

function artifactPath(outDir, name) {
  return path.join(outDir, name);
}

function relativeToolPath(file) {
  return path.relative(path.join(__dirname, '..'), file);
}

function writeArtifact(data, file) {
  writeStructured(data, file);
  return relativeToolPath(file);
}

function buildPreparation(requestText, opts = {}) {
  const intake = buildIntake(requestText, { inputs: opts.inputs || null });
  const selected = intake.routing.selectedPlaybook;
  const playbookPath = path.join(__dirname, '..', selected.file);
  const playbook = readStructured(playbookPath);
  const inputDoc = opts.inputs ? readStructured(opts.inputs) : {};
  const plan = buildPlan(playbook, inputDoc);
  const outDir = ensureDir(opts.outDir || path.join(__dirname, '..', 'runs', todayStamp(), selected.id));
  const artifacts = {};
  const issues = [];

  artifacts.intake = writeArtifact(intake, artifactPath(outDir, `${selected.id}-intake.json`));
  artifacts.plan = writeArtifact(plan, artifactPath(outDir, `${selected.id}-plan.json`));

  if (intake.routing.ambiguity === 'review-required') {
    issues.push({ severity: 'error', type: 'routing_ambiguity', message: 'Request routing requires operator review before sample preparation.' });
  }
  if (intake.inputSummary.missingRequired.length) {
    issues.push({
      severity: 'error',
      type: 'missing_required_inputs',
      missingRequired: intake.inputSummary.missingRequired,
      message: 'Resolve required inputs before generating a live-command sample packet.',
    });
  }
  const templateSelector = selectTemplate(intake, opts.template);
  if (!templateSelector) {
    issues.push({ severity: 'error', type: 'missing_template', message: 'No spec template is available for the selected playbook.' });
  }

  let packet = null;
  let preflight = null;
  let profileCheck = null;

  if (!issues.some(issue => issue.severity === 'error')) {
    packet = buildSampleRunPacketArtifact(plan, templateSelector);
    artifacts.sampleRunPacket = writeArtifact(packet, artifactPath(outDir, `${selected.id}-sample-run.json`));

    const preflightFlags = {
      config: opts.config,
      profile: opts.profile,
      workspace: opts.workspace,
      folder: opts.folder,
      workbook: opts.workbook,
    };
    preflight = buildPreflight(packet, preflightFlags);
    artifacts.preflight = writeArtifact(preflight, artifactPath(outDir, `${selected.id}-preflight.json`));

    if (opts.config) {
      const requiresWorkbook = (packet.runtimeRequirements || []).some(item => item.name === 'CLAY_WORKBOOK_ID' && item.required);
      profileCheck = loadConfigProfile(opts.config, {
        profile: opts.profile || 'default',
        requireResolved: true,
        requirePinnedScope: (opts.requirePinnedScope === true || (opts.requirePinnedScope !== false && Boolean(process.env.CLAY_WORKSPACE_ID))),
        workspace: opts.workspace,
        folder: opts.folder,
        workbook: opts.workbook,
        requireWorkbook: requiresWorkbook,
      });
      if (!profileCheck.valid) {
        issues.push({ severity: 'error', type: 'profile_not_ready', issueCount: profileCheck.issueCount, issues: profileCheck.issues });
      }
    }
  }

  const readyForConfirmation = !!preflight?.readiness?.readyForFirstLiveCommand
    && !issues.some(issue => issue.severity === 'error');

  const manifestPath = artifactPath(outDir, `${selected.id}-prepared-sample-run.json`);
  artifacts.manifest = relativeToolPath(manifestPath);

  const manifest = {
    artifactVersion: 1,
    mode: 'offline-prepared-sample-run',
    generatedAt: new Date().toISOString(),
    request: {
      text: requestText,
      valuePolicy: 'Do not include client row values or secrets in committed requests.',
    },
    selectedPlaybook: {
      id: selected.id,
      name: selected.name,
      file: selected.file,
      confidence: selected.confidence,
      score: selected.score,
    },
    template: templateSelector,
    inputSummary: intake.inputSummary,
    readiness: {
      status: readyForConfirmation ? 'ready_for_first_live_command_confirmation' : 'not_ready',
      readyForFirstLiveCommand: readyForConfirmation,
      firstLiveCommandId: preflight?.readiness?.firstLiveCommandId || null,
      routingAmbiguity: intake.routing.ambiguity,
      missingRequiredInputs: intake.inputSummary.missingRequired,
      preflight: preflight?.readiness || null,
      profileCheck: profileCheck ? {
        valid: profileCheck.valid,
        profile: profileCheck.profile,
        issueCount: profileCheck.issueCount,
        issues: profileCheck.issues,
      } : preflight?.readiness?.profileCheck || null,
    },
    artifacts,
    issues,
    nextAction: readyForConfirmation
      ? `Ask for exact chat confirmation before running ${preflight.readiness.firstLiveCommandId}.`
      : 'Resolve issues before asking for any live Clay command confirmation.',
    hardRules: [
      'No live Clay write/import/run/source-preview without exact chat confirmation for that command.',
      'Only use the workspace and test folder allowed by the selected ignored local profile.',
      'Run at most 10 sample rows before readback and quality reporting.',
    ],
  };

  writeStructured(manifest, manifestPath);
  return manifest;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const requestText = flags.request ? readMaybeFile(flags.request) : flags._.join(' ');
  if (!requestText || flags.help) {
    console.log('Usage: node lib/prepare-sample-run.js --request "Build a campaign personalization table" --inputs input.yaml [--config config.yaml --profile NAME --workspace WORKSPACE --folder FOLDER --workbook WORKBOOK] [--template template.yaml] [--out-dir runs/<date>/<id>] [--json]');
    return;
  }

  const manifest = buildPreparation(requestText, {
    inputs: flags.inputs ? path.resolve(flags.inputs) : null,
    config: flags.config ? path.resolve(flags.config) : null,
    profile: flags.profile,
    workspace: flags.workspace,
    folder: flags.folder,
    workbook: flags.workbook,
    template: flags.template,
    outDir: flags['out-dir'] ? path.resolve(flags['out-dir']) : null,
    requirePinnedScope: (flags['require-pinned-scope'] === true || (flags['require-pinned-scope'] !== false && Boolean(process.env.CLAY_WORKSPACE_ID))),
  });

  if (flags.json) process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
  else process.stdout.write(formatStructured(manifest));
}

if (require.main === module) main();

module.exports = {
  buildPreparation,
  readMaybeFile,
  selectTemplate,
};

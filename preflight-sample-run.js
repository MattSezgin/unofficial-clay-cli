#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { loadConfigProfile } = require('./validate-config');

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

function packetRequiresRuntime(packet, name) {
  return (packet?.runtimeRequirements || []).some(item => item.name === name && item.required);
}

function runtimeFromFlags(flags, packet = null) {
  let profileCheck = null;
  let profileRuntime = {};
  if (flags.config) {
    profileCheck = loadConfigProfile(flags.config, {
      profile: flags.profile || 'default',
      requireResolved: true,
      requirePinnedScope: (flags['require-pinned-scope'] === true || (flags['require-pinned-scope'] !== false && Boolean(process.env.CLAY_WORKSPACE_ID))),
      workspace: flags.workspace,
      folder: flags.folder,
      workbook: flags.workbook,
      requireWorkbook: packetRequiresRuntime(packet, 'CLAY_WORKBOOK_ID'),
      envOverride: flags.env,
    });
    if (profileCheck.resolved) {
      profileRuntime = {
        CLAY_WORKSPACE_ID: profileCheck.resolved.workspaceId,
        CLAY_TEST_FOLDER_ID: profileCheck.resolved.testFolderId,
        CLAY_WORKBOOK_ID: profileCheck.resolved.defaultWorkbookId,
      };
    }
  }

  return {
    runtime: {
      CLAY_WORKSPACE_ID: flags.workspace || process.env.CLAY_WORKSPACE_ID || profileRuntime.CLAY_WORKSPACE_ID,
      CLAY_TEST_FOLDER_ID: flags.folder || process.env.CLAY_TEST_FOLDER_ID || profileRuntime.CLAY_TEST_FOLDER_ID,
      CLAY_WORKBOOK_ID: flags.workbook || process.env.CLAY_WORKBOOK_ID || profileRuntime.CLAY_WORKBOOK_ID,
    },
    profileCheck,
  };
}

function resolveCommand(command, runtime) {
  return String(command || '').replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key) => runtime[key] || match);
}

function findPlaceholders(text) {
  const found = new Set();
  for (const match of String(text || '').matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) found.add(match[1]);
  for (const match of String(text || '').matchAll(/<([A-Za-z0-9_-]+)>/g)) found.add(match[1]);
  return [...found].sort();
}

function buildOperatorPacket(packet, liveCommands, readbackCommands) {
  const firstLiveCommand = liveCommands[0] || null;
  const isSourcePreview = firstLiveCommand?.id === 'preview_source_sample';
  return {
    title: `${packet.playbook?.id || 'clay'} first-live-command operator packet`,
    operatorConfirmationRequired: true,
    firstLiveCommand: firstLiveCommand ? {
      id: firstLiveCommand.id,
      command: firstLiveCommand.command,
      confirmationRequired: firstLiveCommand.confirmationRequired,
      prompt: firstLiveCommand.prompt,
      readyForConfirmation: firstLiveCommand.readyForConfirmation,
      unresolved: firstLiveCommand.unresolved,
    } : null,
    commandBoundary: isSourcePreview
      ? 'Ask the operator to confirm only this source-preview command. Do not batch source-import, apply-spec, dependent people-source preview/import, or any table creation in the same confirmation request.'
      : 'Ask the operator to confirm only this first live command. Do not batch later live commands in the same confirmation request.',
    expectedEvidence: isSourcePreview ? [
      'source-preview returns JSON from run-cpj-preview-enrichment with commandProvenance.commandId = "source_preview".',
      'commandProvenance.workspaceId is the confirmed workspace and sourceFiles contains the previewed source spec.',
      'Preview payload may include task/action metadata and result/count fields; save the full JSON only under ignored runs/.',
      'Use counts/sample fields only to decide whether company matching looks plausible; preview output is not proof that rows were imported.',
    ] : [
      'The command exits successfully and writes/prints a JSON result artifact under ignored runs/.',
      'The result provenance matches the confirmed command and workspace/folder/workbook boundary.',
    ],
    redactionExpectations: [
      'Keep raw preview/readback JSON under ignored runs/ only.',
      'Do not commit client row values, contact data, API tokens, session material, app account IDs, HARs, screenshots, or raw manifests.',
      'Committed notes may mention artifact paths, counts, command ids, and pass/fail findings only.',
    ],
    readbackInspectionSteps: isSourcePreview ? [
      'Inspect the saved preview JSON locally for source_preview provenance, your configured workspace, source file, task/action identifiers, result count, and representative company fields.',
      'Check whether returned company names/domains/LinkedIn URLs plausibly match the requested companies before any import or table creation.',
      'Record a concise redacted readback note under runs/ with counts and quality findings; do not copy raw company/contact values into committed files.',
    ] : readbackCommands.map(command => command.command),
    stopConditionsBeforeImportOrTableCreation: isSourcePreview ? [
      'The operator has not confirmed the exact first live command in chat.',
      'The command differs from the firstLiveCommand.command string in this packet.',
      'Preview fails, returns no usable count/result metadata, or provenance/workspace/source file do not match expectations.',
      'Preview quality suggests wrong companies, low match confidence, unexpected geography/industry, or unexpectedly high/low counts.',
      'Any dependent people-source preview/import is proposed before company preview evidence is reviewed.',
      'Any source-import, apply-spec, table creation, action run, or scale command is proposed before a new exact-command confirmation.',
    ] : packet.stopConditions || [],
  };
}

function buildPreflight(packet, flags = {}) {
  if (packet.mode !== 'offline-sample-run-packet') {
    throw new Error('preflight requires an offline-sample-run-packet artifact');
  }

  const { runtime, profileCheck } = runtimeFromFlags(flags, packet);
  const requiredRuntime = (packet.runtimeRequirements || []).filter(item => item.required);
  const runtimeChecks = requiredRuntime.map(item => ({
    name: item.name,
    required: true,
    expected: item.expected || null,
    present: !!runtime[item.name],
  }));

  // Drift protection: if the operator pinned a workspace in the environment,
  // the runtime must target exactly that workspace; otherwise just require one.
  const pinnedWorkspace = process.env.CLAY_WORKSPACE_ID || null;
  const workspaceCheck = {
    name: 'pinned_workspace',
    expected: pinnedWorkspace,
    present: !!runtime.CLAY_WORKSPACE_ID,
    passed: pinnedWorkspace ? runtime.CLAY_WORKSPACE_ID === pinnedWorkspace : !!runtime.CLAY_WORKSPACE_ID,
  };

  const liveCommands = (packet.liveCommands || []).map(command => {
    const resolvedCommand = resolveCommand(command.command, runtime);
    const unresolved = findPlaceholders(resolvedCommand);
    return {
      id: command.id,
      mode: command.mode,
      confirmationRequired: !!command.confirmationRequired,
      readyForConfirmation: unresolved.length === 0 && !!command.confirmationRequired,
      unresolved,
      command: resolvedCommand,
      prompt: `Confirm this exact Clay command before execution: ${resolvedCommand}`,
    };
  });

  const missingRuntime = runtimeChecks.filter(item => !item.present).map(item => item.name);
  const unresolvedCommands = liveCommands.filter(command => command.unresolved.length > 0).map(command => command.id);
  const ungatedLiveCommands = liveCommands.filter(command => !command.confirmationRequired).map(command => command.id);
  const firstLiveCommand = liveCommands[0] || null;
  const readyForFirstLiveCommand = !!firstLiveCommand
    && firstLiveCommand.unresolved.length === 0
    && firstLiveCommand.confirmationRequired
    && workspaceCheck.passed
    && (!profileCheck || profileCheck.valid);
  const readyForAllLiveCommands = missingRuntime.length === 0
    && unresolvedCommands.length === 0
    && ungatedLiveCommands.length === 0
    && workspaceCheck.passed
    && (!profileCheck || profileCheck.valid);

  return {
    artifactVersion: 1,
    mode: 'offline-sample-run-preflight',
    generatedAt: new Date().toISOString(),
    packet: {
      playbook: packet.playbook,
      template: packet.template,
      sampleBoundary: packet.sampleBoundary,
    },
    readiness: {
      readyForConfirmation: readyForAllLiveCommands,
      readyForFirstLiveCommand,
      firstLiveCommandId: firstLiveCommand?.id || null,
      readyForAllLiveCommands,
      missingRuntime,
      unresolvedCommands,
      ungatedLiveCommands,
      workspaceCheck,
      profileCheck: profileCheck ? {
        valid: profileCheck.valid,
        profile: profileCheck.profile,
        issueCount: profileCheck.issueCount,
        issues: profileCheck.issues,
      } : null,
    },
    runtimeChecks,
    preflightChecks: packet.preflightChecks || [],
    offlineCommands: packet.offlineCommands || [],
    liveCommands,
    readbackCommands: packet.readbackCommands || [],
    operatorPacket: buildOperatorPacket(packet, liveCommands, packet.readbackCommands || []),
    stopConditions: packet.stopConditions || [],
    qualityReport: packet.qualityReport || null,
    valuePolicy: 'This preflight may include runtime IDs in resolved commands. Write it only to ignored runs/ artifacts.',
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const file = flags._[0];
  if (!file || flags.help) {
    console.log('Usage: node preflight-sample-run.js <sample-run.json|yaml> [--config config.yaml --profile NAME] [--workspace WORKSPACE_ID] [--folder FOLDER_ID] [--workbook WORKBOOK_ID] [--out preflight.json]');
    return;
  }

  const packet = readStructured(file);
  const preflight = buildPreflight(packet, flags);
  if (flags.out) {
    console.log(JSON.stringify(writeStructured(preflight, flags.out), null, 2));
    return;
  }
  process.stdout.write(JSON.stringify(preflight, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = {
  buildPreflight,
  findPlaceholders,
  parseArgs,
  packetRequiresRuntime,
  readStructured,
  resolveCommand,
  runtimeFromFlags,
  writeStructured,
};

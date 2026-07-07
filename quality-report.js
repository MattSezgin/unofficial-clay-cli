#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

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

function readAllStdin() {
  return fs.readFileSync(0, 'utf8');
}

function parseStructured(text, hint = '') {
  if (/\.ya?ml$/i.test(hint)) return YAML.parse(text);
  if (/\.json$/i.test(hint)) return JSON.parse(text);
  try {
    return JSON.parse(text);
  } catch {
    return YAML.parse(text);
  }
}

function readStructured(input) {
  if (input === '-') return parseStructured(readAllStdin(), 'stdin.json');
  const text = fs.readFileSync(input, 'utf8');
  return parseStructured(text, input);
}

function bulletList(items) {
  if (!Array.isArray(items) || !items.length) return '- None listed';
  return items.map(item => `- ${item}`).join('\n');
}

function valueOrTodo(value, label = 'TODO') {
  if (value === 0) return '0';
  if (value === false) return 'no';
  if (value === true) return 'yes';
  if (value == null || value === '') return label;
  return String(value);
}

function deriveEvidence(raw = {}) {
  const applyResult = raw.applyResult || {};
  const preflight = raw.preflight || {};
  const hydratedPreflight = raw.hydratedPreflight || {};
  const verifyResult = raw.verifyResult || {};
  const manifest = raw.manifest || {};
  const sample = raw.sample || {};
  const counts = raw.counts || {};
  const provenance = raw.provenance || {};

  const tableId = raw.tableId || applyResult.tableId || manifest.table?.id || null;
  const viewId = raw.viewId || applyResult.viewId || null;
  const rowsTested = counts.rowsTested ?? sample.rowsTested ?? (Array.isArray(manifest.records) ? manifest.records.length : null);
  const liveCommands = [
    ...(preflight.liveCommands || []),
    ...(hydratedPreflight.liveCommands || []),
  ];
  const creditCommands = liveCommands.filter(command => /run-top|source-preview|source-import/i.test(command.command || ''));
  const verifyIssueCount = verifyResult.issueCount ?? verifyResult.issues?.length ?? null;
  const errorCount = counts.errorCount ?? (verifyIssueCount != null ? verifyIssueCount : null);
  const firstRunGatePassed = raw.firstRunGatePassed ?? (errorCount === 0 && rowsTested != null ? true : null);
  const recommendation = raw.recommendation || (firstRunGatePassed === true ? 'continue' : firstRunGatePassed === false ? 'revise' : 'TODO: continue | stop | revise');
  const reason = raw.reason || (firstRunGatePassed === true ? 'Sample evidence has no reported verifier issues.' : null);

  return {
    rowsTested,
    creditConsumingFieldsRun: counts.creditConsumingFieldsRun ?? (creditCommands.length || null),
    successCount: counts.successCount ?? null,
    errorCount,
    manualReviewCount: counts.manualReviewCount ?? null,
    readyCount: counts.readyCount ?? null,
    costNotes: raw.costNotes || null,
    firstRunGatePassed,
    qualityReportReviewed: raw.qualityReportReviewed ?? null,
    scaleCommandScope: raw.scaleCommandScope || null,
    tableId,
    viewId,
    verificationCommand: raw.verificationCommand || (tableId ? `node clay-v2.js verify-table ${tableId}${viewId ? ` --view ${viewId}` : ''} --include-rows 10` : null),
    redactedManifestPath: raw.redactedManifestPath || null,
    fullJsonSamplePath: raw.fullJsonSamplePath || null,
    recommendation,
    reason,
    requiredFixesBeforeScale: raw.requiredFixesBeforeScale || null,
    secondConfirmationReceivedForScale: raw.secondConfirmationReceivedForScale === true,
    liveCommandEvidence: liveCommands.map(command => `${command.id}: ${command.command}`),
    evidenceProvenance: {
      kind: provenance.kind || null,
      sourceArtifactHash: provenance.sourceArtifactSha256 || null,
      sourceCommandCount: Array.isArray(provenance.sourceCommands) ? provenance.sourceCommands.length : null,
    },
  };
}

function renderReport(plan, opts = {}) {
  const generatedAt = new Date().toISOString();
  const playbook = plan.playbook || {};
  const phases = plan.executionPhases || [];
  const firstRunGate = plan.firstRunGate || {};
  const scaleGate = plan.scaleGate || {};
  const outputs = plan.outputs || {};
  const safety = plan.safety || {};
  const evidence = deriveEvidence(opts.evidence || {});

  return `# Clay Sample Quality Report

*Generated: ${generatedAt}*
*Playbook: ${playbook.id || 'unknown'} — ${playbook.name || 'Unknown'}*
*Mode: ${plan.mode || 'unknown'}*

## Scope

- Sample row max: ${plan.sampleRows?.max ?? 'unknown'}
- Sample row recommended: ${plan.sampleRows?.recommended ?? 'unknown'}
- Input readiness: ${plan.inputSummary?.readyForSamplePlan ? 'ready for sample plan' : 'missing required inputs'}
- Missing required inputs: ${(plan.inputSummary?.missingRequired || []).join(', ') || 'none'}

## Safety Gates

Chat confirmation required for:

${bulletList(safety.requiresChatConfirmation)}

Credit-consuming steps:

${bulletList(safety.creditConsumingSteps)}

Hard rules:

${bulletList(safety.hardRules)}

## Offline Plan Evidence

Spec templates:

${bulletList(plan.specTemplates)}

Offline preparation:

${bulletList((plan.offlinePreparation || []).map(step => `${step.id}: ${step.command}`))}

## Execution Phases

${phases.map(phase => `- ${phase.order}. ${phase.id} (${phase.type || 'unknown'}) — confirmation: ${phase.confirmationRequired ? 'required' : 'not required'} — ${phase.commandIntent || 'manual/offline'}`).join('\n') || '- No phases listed'}

## Sample Results

- Rows tested: ${valueOrTodo(evidence.rowsTested)}
- Credit-consuming fields run: ${valueOrTodo(evidence.creditConsumingFieldsRun)}
- Success count: ${valueOrTodo(evidence.successCount)}
- Error count: ${valueOrTodo(evidence.errorCount)}
- Manual review count: ${valueOrTodo(evidence.manualReviewCount)}
- Ready count: ${valueOrTodo(evidence.readyCount)}
- Cost or credit notes: ${valueOrTodo(evidence.costNotes)}

## First-Run Gate

Inspect:

${bulletList(firstRunGate.inspect)}

Pass criteria:

${bulletList(firstRunGate.passCriteria)}

## Scale Gate

Required before scale:

${bulletList(scaleGate.require)}

Scale decision evidence:

- First-run gate passed: ${valueOrTodo(evidence.firstRunGatePassed)}
- Quality report reviewed: ${valueOrTodo(evidence.qualityReportReviewed)}
- User confirmed exact scale command: no
- Scale command/scope: ${valueOrTodo(evidence.scaleCommandScope)}

## Output Checks

Ready columns:

${bulletList(outputs.readyColumns)}

QA views:

${bulletList(outputs.qaViews)}

## Evidence

- Clay workspace/profile: ${valueOrTodo(plan.safety?.liveBoundary?.workspace || plan.variables?.workspaceId)}
- Table ID: ${valueOrTodo(evidence.tableId)}
- View ID: ${valueOrTodo(evidence.viewId)}
- Verification command: ${valueOrTodo(evidence.verificationCommand)}
- Redacted manifest path: ${valueOrTodo(evidence.redactedManifestPath)}
- Full JSON sample path: ${valueOrTodo(evidence.fullJsonSamplePath)}
- Evidence provenance kind: ${valueOrTodo(evidence.evidenceProvenance.kind)}
- Evidence source artifact hash: ${valueOrTodo(evidence.evidenceProvenance.sourceArtifactHash)}
- Evidence source command count: ${valueOrTodo(evidence.evidenceProvenance.sourceCommandCount)}

Live command evidence:

${bulletList(evidence.liveCommandEvidence)}

## Continue / Stop Decision

- Recommendation: ${evidence.recommendation}
- Reason: ${valueOrTodo(evidence.reason)}
- Required fixes before scale: ${valueOrTodo(evidence.requiredFixesBeforeScale)}
- Second confirmation received for scale: ${evidence.secondConfirmationReceivedForScale ? 'yes' : 'no'}

## Known Failure Modes

${bulletList(plan.knownFailureModes)}
`;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const input = flags._[0];
  if (!input || flags.help) {
    console.log('Usage: node quality-report.js <plan.yaml|json|-> [--out report.md]');
    return;
  }

  const plan = readStructured(input);
  const evidence = flags.evidence ? readStructured(flags.evidence) : null;
  const markdown = renderReport(plan, { ...flags, evidence });
  if (flags.out) {
    fs.mkdirSync(path.dirname(flags.out), { recursive: true });
    fs.writeFileSync(flags.out, markdown);
    console.log(JSON.stringify({ wrote: flags.out, bytes: Buffer.byteLength(markdown) }, null, 2));
  } else {
    process.stdout.write(markdown);
  }
}

if (require.main === module) main();

module.exports = {
  bulletList,
  deriveEvidence,
  parseArgs,
  parseStructured,
  readStructured,
  renderReport,
  valueOrTodo,
};

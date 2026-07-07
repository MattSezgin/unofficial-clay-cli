#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { parseArgs, readStructured: readPlanStructured, writeStructured } = require('./plan-playbook');
const { readStructured: readEvidenceStructured } = require('./quality-report');
const { deriveEvidence } = require('./quality-report');
const { buildEvidenceBundleProvenance, hasEvidenceBundleProvenance } = require('./provenance');

function readStructured(file) {
  if (!file) return null;
  const text = fs.readFileSync(file, 'utf8');
  if (/\.ya?ml$/i.test(file)) return YAML.parse(text);
  return JSON.parse(text);
}

function normalizeBool(value) {
  return value === true || value === 'true' || value === 'yes' || value === '1';
}

function proposedCommandIssues(command) {
  const issues = [];
  if (!command) {
    issues.push({ severity: 'error', type: 'missing_scale_command', message: 'Provide the exact proposed scale command.' });
    return issues;
  }
  const hasConfirm = /(^|\s)--confirm(\s|$)/.test(command);
  const hasDevMode = /(^|\s)--dev-mode(\s|$)/.test(command);
  if (!hasConfirm && !hasDevMode) {
    issues.push({ severity: 'error', type: 'scale_command_missing_confirmation_gate', message: 'Scale command must include --confirm, or --dev-mode for scoped sandbox development commands.' });
  }
  if (/(^|\s)--n\s+(?:[1-9]|10)(\s|$)/.test(command)) {
    issues.push({ severity: 'warning', type: 'scale_command_still_sample_sized', message: 'Scale command still appears to target 10 or fewer rows.' });
  }
  if (/\$\{[^}]+\}|<[^>]+>/.test(command)) {
    issues.push({ severity: 'error', type: 'scale_command_unresolved_placeholder', message: 'Scale command contains unresolved placeholders.' });
  }
  return issues;
}

function buildScaleGate(opts = {}) {
  const plan = opts.plan ? readPlanStructured(opts.plan) : {};
  const rawEvidence = opts.evidence ? readEvidenceStructured(opts.evidence) : {};
  const evidence = deriveEvidence(rawEvidence);
  const evidenceProvenanceOk = hasEvidenceBundleProvenance(rawEvidence);
  const evidenceProvenanceStatus = evidenceProvenanceOk ? 'valid_clay_evidence_bundle' : 'missing_or_invalid';
  const workbookParity = opts['workbook-parity'] ? readStructured(opts['workbook-parity']) : null;
  const workbookParityStatus = workbookParity?.status || 'missing';
  const workbookParityOk = workbookParityStatus === 'workbook_parity_complete';
  const proposedScaleCommand = opts.command || evidence.scaleCommandScope || null;
  const qualityReportReviewed = normalizeBool(opts['quality-reviewed']) || evidence.qualityReportReviewed === true;
  const secondConfirmationRequested = normalizeBool(opts['second-confirmed']);
  const requireSecondConfirmation = opts['allow-confirmed-scale'] !== true && opts['allow-confirmed-scale'] !== 'true';
  const secondConfirmationReceived = secondConfirmationRequested && !requireSecondConfirmation;
  const issues = [];

  if (!evidenceProvenanceOk) {
    issues.push({
      severity: 'error',
      type: 'missing_evidence_bundle_provenance',
      message: 'Evidence must include valid clay-evidence-bundle provenance before scale confirmation.',
      evidenceProvenanceStatus,
    });
  }
  if (evidence.firstRunGatePassed !== true) {
    issues.push({ severity: 'error', type: 'first_run_gate_not_passed', actual: evidence.firstRunGatePassed });
  }
  if (!workbookParityOk) {
    issues.push({
      severity: 'error',
      type: workbookParity ? 'workbook_parity_not_complete' : 'missing_workbook_parity',
      actual: workbookParityStatus,
      message: 'Scale readiness requires workbook parity evidence; primitive source/import proof is not sufficient for real-workbook scale.',
    });
  }
  if (evidence.recommendation !== 'continue') {
    issues.push({ severity: 'error', type: 'recommendation_not_continue', actual: evidence.recommendation });
  }
  if (!qualityReportReviewed) {
    issues.push({ severity: 'error', type: 'quality_report_not_reviewed', message: 'A human/operator must review the quality report before scale confirmation.' });
  }
  if (Number(evidence.rowsTested || 0) <= 0) {
    issues.push({ severity: 'error', type: 'missing_rows_tested', actual: evidence.rowsTested });
  }
  if (Number(evidence.errorCount || 0) > 0) {
    issues.push({ severity: 'error', type: 'sample_errors_present', actual: evidence.errorCount });
  }
  issues.push(...proposedCommandIssues(proposedScaleCommand));
  if (secondConfirmationRequested && requireSecondConfirmation) {
    issues.push({
      severity: 'error',
      type: 'second_confirmation_must_happen_in_chat',
      message: 'This tool records readiness only. Do not mark scale confirmed unless the chat confirmation is being handled outside this offline artifact.',
    });
  }

  const blockingIssues = issues.filter(issue => issue.severity === 'error');
  const readyForScaleConfirmation = blockingIssues.length === 0;
  const playbook = plan.playbook || {};
  const confirmationPrompt = readyForScaleConfirmation
    ? `Confirm this exact Clay scale command before execution: ${proposedScaleCommand}`
    : null;

  return {
    artifactVersion: 1,
    provenance: buildEvidenceBundleProvenance({
      sourceFiles: [opts.evidence, opts.plan].filter(Boolean),
      sourceCommands: [
        ...(Array.isArray(rawEvidence.provenance?.sourceCommands) ? rawEvidence.provenance.sourceCommands : []),
        proposedScaleCommand ? {
          commandId: 'proposed_scale_command',
          exactCommand: proposedScaleCommand,
          exitCode: null,
          provenanceKind: 'operator-confirmation-gate',
        } : null,
      ].filter(Boolean),
      tableId: evidence.tableId,
      viewId: evidence.viewId,
    }),
    mode: 'offline-scale-gate',
    generatedAt: new Date().toISOString(),
    playbook: {
      id: playbook.id || null,
      name: playbook.name || null,
    },
    readiness: {
      status: readyForScaleConfirmation ? 'ready_for_second_scale_confirmation' : 'not_ready',
      readyForScaleConfirmation,
      firstRunGatePassed: evidence.firstRunGatePassed,
      recommendation: evidence.recommendation,
      evidenceProvenanceStatus,
      evidenceProvenanceOk,
      workbookParityStatus,
      workbookParityOk,
      qualityReportReviewed,
      secondConfirmationReceived,
    },
    evidenceSummary: {
      evidenceProvenanceStatus,
      evidenceProvenanceOk,
      rowsTested: evidence.rowsTested,
      successCount: evidence.successCount,
      errorCount: evidence.errorCount,
      manualReviewCount: evidence.manualReviewCount,
      readyCount: evidence.readyCount,
      tableId: evidence.tableId,
      viewId: evidence.viewId,
      redactedManifestPath: evidence.redactedManifestPath,
      fullJsonSamplePath: evidence.fullJsonSamplePath,
      requiredFixesBeforeScale: evidence.requiredFixesBeforeScale,
      workbookParityStatus,
      workbookParityOk,
      workbookParitySummary: workbookParity?.summary || null,
    },
    proposedScaleCommand,
    confirmationPrompt,
    issues,
    nextAction: readyForScaleConfirmation
      ? 'Ask for the second explicit chat confirmation using confirmationPrompt. Do not execute scale before that confirmation.'
      : 'Resolve scale-gate issues before asking for scale confirmation.',
    hardRules: [
      'This artifact never confirms or executes scale.',
      'Scale requires a second explicit chat confirmation for the exact command unless a scoped dev-mode policy explicitly allows the action.',
      'Scale is allowed only after sample evidence and quality report review.',
    ],
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || !flags.evidence) {
    console.log('Usage: node lib/scale-gate.js --evidence evidence.json --workbook-parity parity.json --plan plan.json --command "node clay-v2.js run-top ... --confirm|--dev-mode" --quality-reviewed true [--out scale-gate.json]');
    return;
  }

  const gate = buildScaleGate({
    evidence: flags.evidence,
    plan: flags.plan,
    command: flags.command,
    'workbook-parity': flags['workbook-parity'],
    'quality-reviewed': flags['quality-reviewed'],
    'second-confirmed': flags['second-confirmed'],
    'allow-confirmed-scale': flags['allow-confirmed-scale'],
  });

  if (flags.out) {
    console.log(JSON.stringify(writeStructured(gate, flags.out), null, 2));
    return;
  }
  if (flags.json) process.stdout.write(JSON.stringify(gate, null, 2) + '\n');
  else process.stdout.write(YAML.stringify(gate));
}

if (require.main === module) main();

module.exports = {
  buildScaleGate,
  normalizeBool,
  proposedCommandIssues,
};

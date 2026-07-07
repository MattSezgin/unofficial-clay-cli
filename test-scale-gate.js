#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const runDir = path.join(root, 'runs', 'test-template-plan', 'scale-gate');
fs.mkdirSync(runDir, { recursive: true });

const planPath = path.join(runDir, 'plan.json');
const plan = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'plan-playbook.js'),
  path.join(root, 'playbooks', 'outbound-personalization.yaml'),
  '--inputs',
  path.join(root, 'examples', 'outbound-personalization-input.example.yaml'),
  '--spec',
  'specs/templates/outbound-personalization.yaml',
  '--json',
], { encoding: 'utf8' }));
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

const baseEvidence = JSON.parse(fs.readFileSync(path.join(root, 'test', 'quality-fixture.json'), 'utf8'));
const provenancedEvidencePath = path.join(runDir, 'quality-evidence-provenanced.json');
const unprovenancedEvidencePath = path.join(runDir, 'quality-evidence-unprovenanced.json');
const provenancedEvidence = {
  ...baseEvidence,
  provenance: {
    kind: 'clay-evidence-bundle',
    capturedAt: '2026-06-09T00:00:00.000Z',
    sourceArtifactSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceCommands: [
      {
        commandId: 'run_action_sample_1',
        exactCommand: 'node clay-v2.js run-top t_TEST_SAMPLE_TABLE --field "AI Personalization" --view gv_TEST_SAMPLE_VIEW --n 10 --confirm',
        exitCode: 0,
        provenanceKind: 'clay-command',
      },
    ],
  },
};
const unprovenancedEvidence = { ...baseEvidence };
delete unprovenancedEvidence.provenance;
fs.writeFileSync(provenancedEvidencePath, JSON.stringify(provenancedEvidence, null, 2));
fs.writeFileSync(unprovenancedEvidencePath, JSON.stringify(unprovenancedEvidence, null, 2));

const completeParityPath = path.join(runDir, 'workbook-parity-complete.json');
const primitiveParityPath = path.join(runDir, 'workbook-parity-primitive.json');
fs.writeFileSync(completeParityPath, JSON.stringify({
  kind: 'clay-workbook-parity-audit',
  status: 'workbook_parity_complete',
  summary: { actionCount: 5, formulaCount: 8, viewCount: 3, tablesWithRows: 1 },
  missing: [],
}, null, 2));
fs.writeFileSync(primitiveParityPath, JSON.stringify({
  kind: 'clay-workbook-parity-audit',
  status: 'primitive_proof',
  summary: { actionCount: 0, formulaCount: 2, viewCount: 1, tablesWithRows: 1 },
  missing: ['has_actions'],
}, null, 2));

function gate(args) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(root, 'scale-gate.js'),
    ...args,
    '--json',
  ], { encoding: 'utf8', env: {} }));
}

const scaleCommand = 'node clay-v2.js run-top t_TEST_SAMPLE_TABLE --field "AI Personalization" --view gv_TEST_SAMPLE_VIEW --n 100 --confirm';

const ready = gate([
  '--plan',
  planPath,
  '--evidence',
  provenancedEvidencePath,
  '--workbook-parity',
  completeParityPath,
  '--command',
  scaleCommand,
  '--quality-reviewed',
  'true',
]);
assert.strictEqual(ready.mode, 'offline-scale-gate');
assert.strictEqual(ready.readiness.status, 'ready_for_second_scale_confirmation');
assert.strictEqual(ready.readiness.readyForScaleConfirmation, true);
assert.strictEqual(ready.readiness.secondConfirmationReceived, false);
assert.strictEqual(ready.readiness.evidenceProvenanceStatus, 'valid_clay_evidence_bundle');
assert.strictEqual(ready.readiness.evidenceProvenanceOk, true);
assert.strictEqual(ready.readiness.workbookParityStatus, 'workbook_parity_complete');
assert.strictEqual(ready.readiness.workbookParityOk, true);
assert.strictEqual(ready.proposedScaleCommand, scaleCommand);
assert.strictEqual(ready.confirmationPrompt, `Confirm this exact Clay scale command before execution: ${scaleCommand}`);
assert.deepStrictEqual(ready.issues.filter(issue => issue.severity === 'error'), []);
assert.strictEqual(ready.evidenceSummary.evidenceProvenanceStatus, 'valid_clay_evidence_bundle');
assert.strictEqual(ready.evidenceSummary.evidenceProvenanceOk, true);
assert.strictEqual(ready.evidenceSummary.workbookParityOk, true);
assert.strictEqual(ready.evidenceSummary.rowsTested, 10);
assert.strictEqual(ready.evidenceSummary.errorCount, 0);
assert(!JSON.stringify(ready).includes('Example Co'), 'scale gate should not include row values');

const unprovenanced = gate([
  '--plan',
  planPath,
  '--evidence',
  unprovenancedEvidencePath,
  '--workbook-parity',
  completeParityPath,
  '--command',
  scaleCommand,
  '--quality-reviewed',
  'true',
]);
assert.strictEqual(unprovenanced.readiness.status, 'not_ready');
assert.strictEqual(unprovenanced.readiness.evidenceProvenanceStatus, 'missing_or_invalid');
assert.strictEqual(unprovenanced.readiness.evidenceProvenanceOk, false);
assert.strictEqual(unprovenanced.evidenceSummary.evidenceProvenanceStatus, 'missing_or_invalid');
assert.strictEqual(unprovenanced.evidenceSummary.evidenceProvenanceOk, false);
assert(unprovenanced.issues.some(issue => (
  issue.type === 'missing_evidence_bundle_provenance'
  && /clay-evidence-bundle provenance/.test(issue.message)
)));
assert.strictEqual(unprovenanced.confirmationPrompt, null);

const missingParity = gate([
  '--plan',
  planPath,
  '--evidence',
  provenancedEvidencePath,
  '--command',
  scaleCommand,
  '--quality-reviewed',
  'true',
]);
assert.strictEqual(missingParity.readiness.status, 'not_ready');
assert.strictEqual(missingParity.readiness.workbookParityStatus, 'missing');
assert.strictEqual(missingParity.readiness.workbookParityOk, false);
assert(missingParity.issues.some(issue => issue.type === 'missing_workbook_parity'));

const primitiveParity = gate([
  '--plan',
  planPath,
  '--evidence',
  provenancedEvidencePath,
  '--workbook-parity',
  primitiveParityPath,
  '--command',
  scaleCommand,
  '--quality-reviewed',
  'true',
]);
assert.strictEqual(primitiveParity.readiness.status, 'not_ready');
assert.strictEqual(primitiveParity.readiness.workbookParityStatus, 'primitive_proof');
assert.strictEqual(primitiveParity.readiness.workbookParityOk, false);
assert(primitiveParity.issues.some(issue => issue.type === 'workbook_parity_not_complete'));

const notReviewed = gate([
  '--plan',
  planPath,
  '--evidence',
  provenancedEvidencePath,
  '--workbook-parity',
  completeParityPath,
  '--command',
  scaleCommand,
]);
assert.strictEqual(notReviewed.readiness.status, 'not_ready');
assert(notReviewed.issues.some(issue => issue.type === 'quality_report_not_reviewed'));
assert.strictEqual(notReviewed.confirmationPrompt, null);

const devModeCommand = 'node clay-v2.js run-top t_TEST_SAMPLE_TABLE --field "AI Personalization" --view gv_TEST_SAMPLE_VIEW --n 100 --dev-mode';
const devModeReady = gate([
  '--plan',
  planPath,
  '--evidence',
  provenancedEvidencePath,
  '--workbook-parity',
  completeParityPath,
  '--command',
  devModeCommand,
  '--quality-reviewed',
  'true',
]);
assert.strictEqual(devModeReady.readiness.status, 'ready_for_second_scale_confirmation');
assert.strictEqual(devModeReady.proposedScaleCommand, devModeCommand);

const unsafeCommand = gate([
  '--plan',
  planPath,
  '--evidence',
  provenancedEvidencePath,
  '--workbook-parity',
  completeParityPath,
  '--command',
  'node clay-v2.js run-top t_TEST_SAMPLE_TABLE --field "AI Personalization" --view gv_TEST_SAMPLE_VIEW --n 100',
  '--quality-reviewed',
  'true',
]);
assert.strictEqual(unsafeCommand.readiness.status, 'not_ready');
assert(unsafeCommand.issues.some(issue => issue.type === 'scale_command_missing_confirmation_gate'));

const selfConfirmed = gate([
  '--plan',
  planPath,
  '--evidence',
  provenancedEvidencePath,
  '--workbook-parity',
  completeParityPath,
  '--command',
  scaleCommand,
  '--quality-reviewed',
  'true',
  '--second-confirmed',
  'true',
]);
assert.strictEqual(selfConfirmed.readiness.status, 'not_ready');
assert(selfConfirmed.issues.some(issue => issue.type === 'second_confirmation_must_happen_in_chat'));

const outPath = path.join(runDir, 'scale-gate.json');
const writeResult = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'scale-gate.js'),
  '--plan',
  planPath,
  '--evidence',
  provenancedEvidencePath,
  '--workbook-parity',
  completeParityPath,
  '--command',
  scaleCommand,
  '--quality-reviewed',
  'true',
  '--out',
  outPath,
], { encoding: 'utf8', env: {} }));
assert(writeResult.wrote.endsWith('scale-gate.json'));
const writtenGate = JSON.parse(fs.readFileSync(outPath, 'utf8'));
assert.strictEqual(writtenGate.readiness.readyForScaleConfirmation, true);
assert.strictEqual(writtenGate.provenance.kind, 'clay-evidence-bundle');
assert.match(writtenGate.provenance.sourceArtifactSha256, /^[a-f0-9]{64}$/);

const externallyConfirmed = gate([
  '--plan',
  planPath,
  '--evidence',
  provenancedEvidencePath,
  '--workbook-parity',
  completeParityPath,
  '--command',
  scaleCommand,
  '--quality-reviewed',
  'true',
  '--second-confirmed',
  'true',
  '--allow-confirmed-scale',
  'true',
]);
assert.strictEqual(externallyConfirmed.readiness.readyForScaleConfirmation, true);
assert.strictEqual(externallyConfirmed.readiness.secondConfirmationReceived, true);
assert.strictEqual(externallyConfirmed.provenance.kind, 'clay-evidence-bundle');

console.log(JSON.stringify({ ok: true, checked: 'scale-gate' }, null, 2));

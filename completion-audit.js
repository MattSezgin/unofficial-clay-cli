#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { parseArgs } = require('./plan-playbook');
const {
  hasClayCommandProvenance,
  hasEvidenceBundleProvenance,
} = require('./provenance');
const { buildWorkbookParityAudit } = require('./workbook-parity');

const ROOT = __dirname;

function readStructured(file) {
  if (!file) return null;
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(full)) return null;
  const text = fs.readFileSync(full, 'utf8');
  if (/\.ya?ml$/i.test(full)) return YAML.parse(text);
  return JSON.parse(text);
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function readText(rel) {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

function readPackageJson() {
  return JSON.parse(readText('package.json') || '{}');
}

function scriptIncludes(scriptName) {
  const pkg = readPackageJson();
  return Boolean(pkg.scripts && pkg.scripts[scriptName]);
}

function binIncludes(binName) {
  const pkg = readPackageJson();
  return Boolean(pkg.bin && pkg.bin[binName]);
}

function listFiles(relDir, predicate = () => true) {
  const full = path.join(ROOT, relDir);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) return predicate(full) ? [full] : [];
  const files = [];
  for (const child of fs.readdirSync(full)) {
    const childPath = path.join(full, child);
    const childStat = fs.statSync(childPath);
    if (childStat.isDirectory()) files.push(...listFiles(path.relative(ROOT, childPath), predicate));
    else if (predicate(childPath)) files.push(childPath);
  }
  return files;
}

function hasSimulatedMarker(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (value.simulated === true) return true;
  if (typeof value.mode === 'string' && value.mode.includes('simulation')) return true;
  if (typeof value.warning === 'string' && /fake evidence|simulat/i.test(value.warning)) return true;
  return Object.values(value).some(child => hasSimulatedMarker(child, seen));
}

function artifactStatus(artifact) {
  if (!artifact) return 'missing';
  return hasSimulatedMarker(artifact) ? 'simulated_only' : 'present';
}

function statusRank(status) {
  return {
    passed: 0,
    present: 0,
    simulated_only: 1,
    incomplete: 2,
    missing: 3,
    failed: 4,
  }[status] ?? 4;
}

function combineStatus(statuses) {
  return statuses.slice().sort((a, b) => statusRank(b) - statusRank(a))[0] || 'missing';
}

function requirement(id, title, status, evidence, blockingReason) {
  return {
    id,
    title,
    status,
    evidence: evidence.filter(Boolean),
    blockingReason: status === 'passed' ? null : blockingReason,
  };
}

function directoryCount(relDir, ext) {
  return listFiles(relDir, file => file.endsWith(ext)).length;
}

function publicScanCovers(rel) {
  const scanner = readText('test-public-readiness.js');
  // A whole-tree scanner covers every file by construction - no per-file list needed.
  if (scanner.includes("mode: 'whole-tree'")) return true;
  return scanner.includes(`'${rel}'`) || scanner.includes(`"${rel}"`);
}

function packageChecks() {
  const requiredFiles = [
    'README.md',
    'AGENTS.md',
    '.gitignore',
    'config.example.yaml',
    'docs/operator-runbook.md',
    'playbooks',
    'prompts',
    'examples',
    'specs/templates',
    'intake-request.js',
    'prompt-library.js',
    'profile-context.js',
    'prepare-sample-run.js',
    'advance-sample-run.js',
    'scale-gate.js',
    'simulate-full-loop.js',
    'completion-audit.js',
    'workbook-parity.js',
  ];
  const missingFiles = requiredFiles.filter(file => !exists(file));
  const requiredScripts = [
    'check',
    'smoke:validate',
    'test:playbooks',
    'test:prompts',
    'test:intake',
    'test:profile',
    'test:prepare',
    'test:advance',
    'test:scale',
    'test:simulate',
    'test:public',
    'test:audit',
    'test:parity',
    'test:all',
  ];
  const missingScripts = requiredScripts.filter(script => !scriptIncludes(script));
  const publicScanMissing = ['README.md', 'AGENTS.md', '.gitignore', 'config.example.yaml', 'completion-audit.js', 'profile-context.js', 'prompt-library.js', 'workbook-parity.js', 'prompts']
    .filter(file => !publicScanCovers(file));
  return {
    missingFiles,
    missingScripts,
    publicScanMissing,
    playbookCount: directoryCount('playbooks', '.yaml'),
    exampleCount: directoryCount('examples', '.yaml'),
    promptCount: directoryCount('prompts', '.yaml'),
    templateCount: directoryCount('specs/templates', '.yaml'),
    hasAuditBin: binIncludes('clay-completion-audit'),
    hasProfileBin: binIncludes('clay-profile-context'),
    hasPromptBin: binIncludes('clay-prompt-library'),
    hasWorkbookParityBin: binIncludes('clay-workbook-parity'),
  };
}

function auditArtifacts(opts = {}) {
  return {
    prepared: readStructured(opts.prepared),
    applyResult: readStructured(opts['apply-result']),
    advanced: readStructured(opts.advanced),
    evidence: readStructured(opts.evidence),
    scaleGate: readStructured(opts['scale-gate']),
    workbookParity: readStructured(opts['workbook-parity']),
    simulation: readStructured(opts.simulation),
    qualityReportText: opts['quality-report']
      ? fs.readFileSync(path.isAbsolute(opts['quality-report']) ? opts['quality-report'] : path.join(ROOT, opts['quality-report']), 'utf8')
      : null,
  };
}

function buildCompletionAudit(opts = {}) {
  const pkg = packageChecks();
  const artifacts = auditArtifacts(opts);
  const preparedStatus = artifactStatus(artifacts.prepared);
  const applyResultStatus = artifactStatus(artifacts.applyResult);
  const advancedStatus = artifactStatus(artifacts.advanced);
  const evidenceStatus = artifactStatus(artifacts.evidence);
  const scaleGateStatus = artifactStatus(artifacts.scaleGate);
  const simulationStatus = artifactStatus(artifacts.simulation);
  const workbookParityStatus = artifactStatus(artifacts.workbookParity);
  const hasReport = Boolean(artifacts.qualityReportText);
  const reportSimulated = hasReport && /simulat|fake evidence/i.test(artifacts.qualityReportText);

  const packageReady = pkg.missingFiles.length === 0
    && pkg.missingScripts.length === 0
    && pkg.publicScanMissing.length === 0
    && pkg.playbookCount >= 7
    && pkg.promptCount >= pkg.playbookCount
    && pkg.exampleCount >= 7
    && pkg.templateCount >= 7
    && pkg.hasAuditBin
    && pkg.hasWorkbookParityBin;

  const preparedReady = artifacts.prepared?.readiness?.readyForFirstLiveCommand === true;
  const applyProvenanceOk = hasClayCommandProvenance(artifacts.applyResult, /\b(?:apply-spec|source-import)\b/);
  const evidenceProvenanceOk = hasEvidenceBundleProvenance(artifacts.evidence);
  const scaleGateProvenanceOk = hasEvidenceBundleProvenance(artifacts.scaleGate);
  const sampleTableId = artifacts.applyResult?.tableId || artifacts.applyResult?.table?.id || artifacts.applyResult?.destinationTableId || artifacts.applyResult?.result?.tableId;
  const sampleViewId = artifacts.applyResult?.viewId || artifacts.applyResult?.view?.id || artifacts.applyResult?.result?.viewId;
  const applyBuiltSample = Boolean(
    artifacts.applyResult
    && (artifacts.applyResult.applied === true || artifacts.applyResult.imported === true)
    && sampleTableId
    && sampleViewId
    && applyProvenanceOk
  );
  const advancedReady = artifacts.advanced?.readiness?.readyForNextLiveCommand === true;
  const evidenceLive = evidenceStatus === 'present' && evidenceProvenanceOk;
  const firstRunPassed = artifacts.evidence?.firstRunGatePassed === true || artifacts.advanced?.readiness?.firstRunGatePassed === true;
  const rowsTested = Number(artifacts.evidence?.counts?.rowsTested || artifacts.evidence?.rowsTested || 0);
  const recommendation = artifacts.evidence?.recommendation || artifacts.advanced?.readiness?.recommendation || null;
  const scaleGateReady = artifacts.scaleGate?.readiness?.readyForScaleConfirmation === true;
  const scaleGateCommand = artifacts.scaleGate?.proposedScaleCommand || '';
  const devModeScaleGate = /(^|\s)--dev-mode(\s|$)/.test(scaleGateCommand);
  const secondConfirmationReceived = artifacts.scaleGate?.readiness?.secondConfirmationReceived === true || (scaleGateReady && devModeScaleGate);
  const workbookParityAudit = artifacts.workbookParity?.kind === 'clay-workbook-parity-fixture'
    ? buildWorkbookParityAudit(artifacts.workbookParity)
    : artifacts.workbookParity;
  const workbookParityComplete = workbookParityAudit?.kind === 'clay-workbook-parity-audit' && workbookParityAudit.status === 'workbook_parity_complete';
  const workbookParityPrimitive = workbookParityAudit?.kind === 'clay-workbook-parity-audit' && workbookParityAudit.status === 'primitive_proof';

  const requirements = [
    requirement(
      'plain_language_intake',
      'Plain-language request intake',
      exists('intake-request.js') && scriptIncludes('test:intake') ? 'passed' : 'missing',
      ['intake-request.js exists', scriptIncludes('test:intake') && 'test:intake script exists'],
      'Intake command or test script is missing.'
    ),
    requirement(
      'playbook_selection',
      'Playbook selection and library coverage',
      pkg.playbookCount >= 7 && scriptIncludes('test:playbooks') ? 'passed' : 'missing',
      [`${pkg.playbookCount} playbooks found`, scriptIncludes('test:playbooks') && 'test:playbooks script exists'],
      'Expected at least seven playbooks plus playbook tests.'
    ),
    requirement(
      'input_gathering',
      'Required input gathering',
      pkg.exampleCount >= pkg.playbookCount && exists('prepare-sample-run.js') ? 'passed' : 'missing',
      [`${pkg.exampleCount} example input files found`, 'prepare-sample-run.js exists'],
      'Every playbook needs public-safe example input and preparation support.'
    ),
    requirement(
      'offline_plan_validation',
      'Offline plan/spec validation',
      scriptIncludes('smoke:validate') && scriptIncludes('test:plan') && pkg.templateCount >= pkg.playbookCount ? 'passed' : 'missing',
      [`${pkg.templateCount} spec templates found`, scriptIncludes('smoke:validate') && 'smoke:validate script exists', scriptIncludes('test:plan') && 'test:plan script exists'],
      'Offline spec/template validation is incomplete.'
    ),
    requirement(
      'preflight_dry_run',
      'Preflight and no-live-command dry run',
      exists('preflight-sample-run.js') && scriptIncludes('test:preflight') ? 'passed' : 'missing',
      ['preflight-sample-run.js exists', scriptIncludes('test:preflight') && 'test:preflight script exists'],
      'Preflight support or coverage is missing.'
    ),
    requirement(
      'confirmation_gates',
      'Exact-command confirmation gates',
      exists('AGENTS.md') && exists('scale-gate.js') && scriptIncludes('test:scale') ? 'passed' : 'missing',
      ['AGENTS.md exists', 'scale-gate.js exists', scriptIncludes('test:scale') && 'test:scale script exists'],
      'Confirmation-gate instructions or scale-gate coverage is missing.'
    ),
    requirement(
      'live_sample_build',
      'Real small sample build in test workspace',
      preparedStatus === 'simulated_only' || applyResultStatus === 'simulated_only' || simulationStatus === 'simulated_only'
        ? 'simulated_only'
        : preparedStatus === 'present' && preparedReady && applyResultStatus === 'present' && applyBuiltSample
          ? 'passed'
          : preparedStatus === 'present' || applyResultStatus === 'present'
            ? 'incomplete'
            : 'missing',
      [
        preparedStatus !== 'missing' && `prepared artifact is ${preparedStatus}`,
        applyResultStatus !== 'missing' && `apply result artifact is ${applyResultStatus}`,
        preparedReady && 'prepared artifact is ready for first live command confirmation',
        applyProvenanceOk && 'apply/import result has clay-command provenance',
        applyBuiltSample && 'apply/import result includes table/view IDs',
        simulationStatus === 'simulated_only' && 'simulation artifact is simulated',
      ],
      preparedStatus === 'simulated_only' || applyResultStatus === 'simulated_only' || simulationStatus === 'simulated_only'
        ? 'Simulated artifacts do not prove a live Clay sample was built.'
        : 'A ready prepared artifact is not enough; a non-simulated apply/import result with table/view IDs and clay-command provenance is required.'
    ),
    requirement(
      'workbook_parity',
      'Real workbook parity evidence',
      workbookParityStatus === 'simulated_only'
        ? 'simulated_only'
        : workbookParityComplete
          ? 'passed'
          : workbookParityStatus === 'present'
            ? 'incomplete'
            : 'missing',
      [
        workbookParityStatus !== 'missing' && `workbook parity artifact is ${workbookParityStatus}`,
        workbookParityAudit?.status && `workbook parity status: ${workbookParityAudit.status}`,
        workbookParityAudit?.summary && `${workbookParityAudit.summary.actionCount || 0} action(s), ${workbookParityAudit.summary.promptedActionCount || 0} prompted action(s), ${workbookParityAudit.summary.runConditionActionCount || 0} run condition(s)`,
        workbookParityPrimitive && 'artifact is primitive proof, not real workbook parity',
      ],
      workbookParityStatus === 'simulated_only'
        ? 'Simulated workbook parity does not prove a real Clay workbook.'
        : workbookParityStatus === 'present'
          ? 'Workbook parity artifact is present but does not satisfy real-workbook requirements.'
          : 'A workbook parity audit or fixture is required; source/import proof alone is insufficient.'
    ),
    requirement(
      'first_10_action_rows',
      'First-10 action-row run evidence',
      evidenceStatus === 'simulated_only' || advancedStatus === 'simulated_only'
        ? 'simulated_only'
        : evidenceLive && firstRunPassed && rowsTested > 0 && rowsTested <= 10
          ? 'passed'
          : evidenceLive
            ? 'incomplete'
            : 'missing',
      [
        evidenceStatus !== 'missing' && `evidence artifact is ${evidenceStatus}`,
        advancedStatus !== 'missing' && `advanced artifact is ${advancedStatus}`,
        evidenceProvenanceOk && 'evidence has clay-evidence-bundle provenance',
        rowsTested > 0 && `rows tested: ${rowsTested}`,
        firstRunPassed && 'first-run gate passed',
      ],
      evidenceStatus === 'simulated_only' || advancedStatus === 'simulated_only'
        ? 'Simulated evidence does not prove first-10 Clay rows ran.'
        : 'Real first-10 evidence is missing or incomplete.'
    ),
    requirement(
      'readback_quality_report',
      'Readback, verification, and quality report',
      evidenceStatus === 'simulated_only' || reportSimulated
        ? 'simulated_only'
        : evidenceLive && firstRunPassed && hasReport
          ? 'passed'
          : evidenceLive || hasReport
            ? 'incomplete'
            : 'missing',
      [
        evidenceStatus !== 'missing' && `evidence artifact is ${evidenceStatus}`,
        evidenceProvenanceOk && 'evidence has clay-evidence-bundle provenance',
        hasReport && 'quality report supplied',
        reportSimulated && 'quality report appears simulated',
      ],
      evidenceStatus === 'simulated_only' || reportSimulated
        ? 'Fake report/evidence cannot satisfy readback proof.'
        : 'Real readback evidence and quality report are both required.'
    ),
    requirement(
      'continue_stop_recommendation',
      'Continue/stop recommendation from real evidence',
      evidenceStatus === 'simulated_only'
        ? 'simulated_only'
        : evidenceLive && ['continue', 'revise', 'stop'].includes(recommendation)
          ? 'passed'
          : evidenceLive
            ? 'incomplete'
            : 'missing',
      [
        evidenceStatus !== 'missing' && `evidence artifact is ${evidenceStatus}`,
        evidenceProvenanceOk && 'evidence has clay-evidence-bundle provenance',
        recommendation && `recommendation: ${recommendation}`,
      ],
      evidenceStatus === 'simulated_only'
        ? 'Simulated recommendation is not live evidence.'
        : 'Recommendation must come from real evidence.'
    ),
    requirement(
      'scale_gate_second_confirmation',
      'Scale gate plus second exact-command confirmation',
      scaleGateStatus === 'simulated_only'
        ? 'simulated_only'
        : scaleGateStatus === 'present' && scaleGateReady && secondConfirmationReceived && scaleGateProvenanceOk
          ? 'passed'
          : scaleGateStatus === 'present' && scaleGateReady
            ? 'incomplete'
            : scaleGateStatus === 'present'
              ? 'incomplete'
              : 'missing',
      [
        scaleGateStatus !== 'missing' && `scale gate artifact is ${scaleGateStatus}`,
        scaleGateReady && 'scale gate is ready for second confirmation',
        scaleGateProvenanceOk && 'scale gate preserves clay-evidence-bundle provenance',
        secondConfirmationReceived && (devModeScaleGate ? 'dev-mode scale gate recorded' : 'second confirmation recorded'),
      ],
      scaleGateStatus === 'simulated_only'
        ? 'Simulated scale gate cannot authorize scale.'
        : scaleGateReady
          ? 'Second exact-command confirmation or scoped dev-mode scale gate provenance is required before scale.'
          : 'Scale gate is missing or not ready.'
    ),
    requirement(
      'public_repo_checklist',
      'Public repo checklist and package hygiene',
      packageReady ? 'passed' : 'incomplete',
      [
        `${pkg.playbookCount} playbooks`,
        `${pkg.promptCount} prompts`,
        `${pkg.exampleCount} examples`,
        `${pkg.templateCount} templates`,
        pkg.hasAuditBin && 'clay-completion-audit bin exists',
        pkg.hasProfileBin && 'clay-profile-context bin exists',
        pkg.hasPromptBin && 'clay-prompt-library bin exists',
        pkg.hasWorkbookParityBin && 'clay-workbook-parity bin exists',
        pkg.publicScanMissing.length === 0 && 'public scan covers required files',
      ],
      `Missing package readiness pieces: ${[
        ...pkg.missingFiles.map(file => `file:${file}`),
        ...pkg.missingScripts.map(script => `script:${script}`),
        ...pkg.publicScanMissing.map(file => `public-scan:${file}`),
        pkg.hasAuditBin ? null : 'bin:clay-completion-audit',
        pkg.hasProfileBin ? null : 'bin:clay-profile-context',
        pkg.hasPromptBin ? null : 'bin:clay-prompt-library',
        pkg.hasWorkbookParityBin ? null : 'bin:clay-workbook-parity',
      ].filter(Boolean).join(', ')}`
    ),
  ];

  const summary = requirements.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const overallStatus = requirements.every(item => item.status === 'passed') ? 'complete' : 'not_complete';
  const nextActions = requirements
    .filter(item => item.status !== 'passed')
    .map(item => `${item.id}: ${item.blockingReason}`)
    .slice(0, 8);

  return {
    artifactVersion: 1,
    mode: 'offline-completion-audit',
    generatedAt: new Date().toISOString(),
    overallStatus,
    summary,
    packageChecks: pkg,
    artifactClassification: {
      prepared: preparedStatus,
      applyResult: applyResultStatus,
      advanced: advancedStatus,
      evidence: evidenceStatus,
      qualityReport: hasReport ? (reportSimulated ? 'simulated_only' : 'present') : 'missing',
      scaleGate: scaleGateStatus,
      workbookParity: workbookParityStatus,
      simulation: simulationStatus,
    },
    requirements,
    nextActions,
    hardRules: [
      'This audit never executes Clay commands.',
      'Simulated artifacts are useful for control-plane testing only.',
      'Live completion requires real Clay readback evidence plus chat confirmations.',
      'Primitive source/import proof is not real workbook parity.',
    ],
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log('Usage: node completion-audit.js [--prepared file] [--apply-result file] [--advanced file] [--evidence file] [--quality-report file] [--scale-gate file] [--workbook-parity file] [--simulation file] [--json]');
    return;
  }

  const audit = buildCompletionAudit(flags);
  if (flags.out) {
    const full = path.isAbsolute(flags.out) ? flags.out : path.join(ROOT, flags.out);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(audit, null, 2) + '\n');
    console.log(JSON.stringify({ wrote: path.relative(ROOT, full), overallStatus: audit.overallStatus }, null, 2));
    return;
  }
  if (flags.json) process.stdout.write(JSON.stringify(audit, null, 2) + '\n');
  else process.stdout.write(YAML.stringify(audit));
}

if (require.main === module) main();

module.exports = {
  buildCompletionAudit,
  combineStatus,
  hasSimulatedMarker,
  packageChecks,
};

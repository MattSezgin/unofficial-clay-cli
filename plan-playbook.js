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

function readStructured(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (/\.ya?ml$/i.test(file)) return YAML.parse(text);
  return JSON.parse(text);
}

function writeStructured(data, file) {
  const text = /\.json$/i.test(file)
    ? JSON.stringify(data, null, 2) + '\n'
    : YAML.stringify(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { wrote: file, bytes: Buffer.byteLength(text) };
}

function formatStructured(data, hint = '') {
  return /\.json$/i.test(hint) ? JSON.stringify(data, null, 2) + '\n' : YAML.stringify(data);
}

function discoverSpecTemplates(playbookId) {
  const dir = path.join(__dirname, 'specs', 'templates');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.yaml') || file.endsWith('.json'))
    .filter(file => file === `${playbookId}.yaml` || file === `${playbookId}.json` || file.startsWith(`${playbookId}-`))
    .sort()
    .map(file => path.join('specs', 'templates', file));
}

function discoverPromptContract(playbookId) {
  const dir = path.join(__dirname, 'prompts');
  if (!fs.existsSync(dir)) return null;
  const file = [`${playbookId}.yaml`, `${playbookId}.json`]
    .find(candidate => fs.existsSync(path.join(dir, candidate)));
  return file ? path.join('prompts', file) : null;
}

function inspectPromptContract(promptPath) {
  if (!promptPath) return null;
  const fullPath = path.join(__dirname, promptPath);
  if (!fs.existsSync(fullPath)) {
    return {
      status: 'missing',
      file: promptPath,
      valuePolicy: 'Prompt contract file was not found.',
    };
  }
  const prompt = readStructured(fullPath);
  return {
    status: 'present',
    file: promptPath,
    id: prompt.id || null,
    playbookId: prompt.playbookId || null,
    name: prompt.name || null,
    mode: prompt.mode || null,
    requiredInputs: prompt.inputFields?.required || [],
    optionalInputs: prompt.inputFields?.optional || [],
    outputFields: Object.keys(prompt.outputSchema || {}),
    guardrails: prompt.guardrails || [],
    qaChecks: prompt.qaChecks || [],
    valuePolicy: prompt.valuePolicy || 'Runtime values omitted from committed artifacts.',
    valuesIncluded: false,
  };
}

function collectRequiredInputs(inputs = {}) {
  return [
    ...(inputs.requiredColumns || []),
    ...(inputs.requiredBrief || []),
    ...(inputs.requiredPayloadFields || []),
    ...(inputs.requiredParameters || []),
  ];
}

function collectProvidedInputKeys(inputDoc = {}) {
  const keys = new Set();
  for (const section of ['columns', 'brief', 'payload', 'parameters', 'quality']) {
    for (const key of Object.keys(inputDoc[section] || {})) keys.add(key);
  }
  for (const key of inputDoc.providedColumns || []) keys.add(key);
  return keys;
}

function summarizeInputs(playbook, inputDoc) {
  const required = collectRequiredInputs(playbook.inputs);
  const provided = collectProvidedInputKeys(inputDoc);
  const missing = required.filter(key => !provided.has(key));
  return {
    required,
    provided: [...provided].sort(),
    missingRequired: missing,
    readyForSamplePlan: missing.length === 0,
    valuePolicy: 'Input values are intentionally omitted from generated plans; only keys/counts are shown.',
  };
}

function collectDeclaredInputs(inputs = {}) {
  return [
    ...(inputs.requiredColumns || []).map(key => ({ key, section: 'columns', required: true })),
    ...(inputs.optionalColumns || []).map(key => ({ key, section: 'columns', required: false })),
    ...(inputs.requiredBrief || []).map(key => ({ key, section: 'brief', required: true })),
    ...(inputs.optionalBrief || []).map(key => ({ key, section: 'brief', required: false })),
    ...(inputs.requiredPayloadFields || []).map(key => ({ key, section: 'payload', required: true })),
    ...(inputs.optionalPayloadFields || []).map(key => ({ key, section: 'payload', required: false })),
    ...(inputs.requiredParameters || []).map(key => ({ key, section: 'parameters', required: true })),
    ...(inputs.optionalParameters || []).map(key => ({ key, section: 'parameters', required: false })),
  ];
}

function buildInputBindingPlan(playbook, inputDoc = {}) {
  const provided = collectProvidedInputKeys(inputDoc);
  return collectDeclaredInputs(playbook.inputs).map(input => ({
    key: input.key,
    section: input.section,
    required: input.required,
    provided: provided.has(input.key),
    valuePolicy: 'omitted-from-plan-output',
  }));
}

function inspectTemplate(specPath) {
  const fullPath = path.join(__dirname, specPath);
  if (!fs.existsSync(fullPath)) {
    return { kind: 'missing', purpose: 'Template file was not found.' };
  }

  try {
    const spec = readStructured(fullPath);
    if (spec.source) {
      const filters = spec.source.filters || {};
      return {
        kind: 'source',
        sourceType: spec.source.type || 'unknown',
        limit: spec.source.limit ?? null,
        requiresUpstreamTable: Boolean(filters.company_table_id || filters.company_table_view_id || filters.company_record_id),
        extractFields: Array.isArray(spec.source.extract) ? spec.source.extract.map(field => field.name).filter(Boolean) : [],
      };
    }
    return {
      kind: 'table',
      tableName: spec.table?.name || null,
      viewName: spec.view?.name || null,
      fieldCount: Array.isArray(spec.fields) ? spec.fields.length : 0,
      actionFields: Array.isArray(spec.fields) ? spec.fields
        .filter(field => field.type === 'action')
        .map(field => field.name)
        .filter(Boolean) : [],
      sampleRowCount: Array.isArray(spec.rows) ? spec.rows.length : 0,
    };
  } catch (error) {
    return { kind: 'unreadable', purpose: `Template could not be parsed: ${error.message}` };
  }
}

function commandStep(id, command, mode, confirmationRequired = false) {
  return { id, command, mode, confirmationRequired };
}

function buildTemplatePlan(specPath, playbook, index) {
  const inspection = inspectTemplate(specPath);
  const base = {
    id: `${playbook.id}_template_${index + 1}`,
    template: specPath,
    kind: inspection.kind,
    inspection,
    sampleRows: {
      max: Number(playbook.sampleRows?.max || 10),
      policy: 'Do not exceed sampleRows.max before a fresh readback, quality report, and explicit scale confirmation.',
    },
  };

  const commands = [
    commandStep('validate_template', `node clay-v2.js validate-spec ${specPath}`, 'offline', false),
  ];

  if (inspection.kind === 'source') {
    commands.push(
      commandStep('preview_source_sample', `node clay-v2.js source-preview ${specPath} --workspace "\${CLAY_WORKSPACE_ID}" --confirm`, 'live-clay', true),
      commandStep('import_source_sample', `node clay-v2.js source-import ${specPath} --workspace "\${CLAY_WORKSPACE_ID}" --destination-table <sample-table> --confirm`, 'live-clay', true),
      commandStep('readback_sample', 'node clay-v2.js manifest <sample-table> --view <sample-view> --include-rows 10 --out <redacted.json>', 'live-clay-read', false),
    );
  } else if (inspection.kind === 'table') {
    commands.push(
      commandStep('apply_sample_spec', `node clay-v2.js apply-spec ${specPath} --workspace "\${CLAY_WORKSPACE_ID}" --folder "\${CLAY_TEST_FOLDER_ID}" --workbook "\${CLAY_WORKBOOK_ID}" --confirm`, 'live-clay', true),
      ...((inspection.actionFields || []).map((fieldName, actionIndex) => (
        commandStep(`run_action_sample_${actionIndex + 1}`, `node clay-v2.js run-top <sample-table> --field "${fieldName}" --view <sample-view> --n ${Math.min(Number(playbook.sampleRows?.max || 10), 10)} --confirm`, 'live-clay', true)
      ))),
      commandStep('verify_sample_table', 'node clay-v2.js verify-table <sample-table> --view <sample-view> --include-rows 10', 'live-clay-read', false),
      commandStep('manifest_readback', 'node clay-v2.js manifest <sample-table> --view <sample-view> --include-rows 10 --out <redacted.json>', 'live-clay-read', false),
    );
  }

  return {
    ...base,
    commands,
  };
}

function commandRefs(templatePlan, predicate) {
  return (templatePlan.commands || [])
    .filter(predicate)
    .map(command => ({
      template: templatePlan.template,
      commandId: command.id,
      command: command.command,
      mode: command.mode,
      confirmationRequired: command.confirmationRequired,
    }));
}

function tableOutputAlias(templatePlan, tableIndex) {
  const tableName = templatePlan.inspection?.tableName || path.basename(templatePlan.template, path.extname(templatePlan.template));
  return {
    alias: tableIndex === 0 ? 'primary-sample-table' : `sample-table-${tableIndex + 1}`,
    template: templatePlan.template,
    tableName,
    tablePlaceholder: '<sample-table>',
    viewPlaceholder: '<sample-view>',
    valuePolicy: 'Runtime table/view IDs are filled only from live apply/readback artifacts.',
  };
}

function templateRole(value) {
  const text = String(value || '').toLowerCase();
  if (/(^|[-_\s])(company|companies)([-_\s]|$)/.test(text) || text.includes('company-stage')) return 'company';
  if (/(^|[-_\s])(people|person|contacts?)([-_\s]|$)/.test(text) || text.includes('people-stage')) return 'people';
  if (/(^|[-_\s])webhook([-_\s]|$)/.test(text)) return 'webhook';
  return null;
}

function sourceDestination(sourcePlan, tableOutputs) {
  const base = path.basename(sourcePlan.template, path.extname(sourcePlan.template)).toLowerCase();
  const sourceRole = templateRole(sourcePlan.inspection?.sourceType) || templateRole(base);
  if (!tableOutputs.length) {
    return {
      status: 'requires-existing-destination-table',
      reason: 'No table template was discovered for this source; provide a confirmed destination table at live import time.',
      tableAlias: null,
    };
  }

  const matching = tableOutputs.find(output => {
    const outputRole = templateRole(output.tableName) || templateRole(path.basename(output.template, path.extname(output.template)));
    return sourceRole && outputRole && sourceRole === outputRole;
  });

  if (!matching && sourceRole === 'people') {
    return {
      status: 'requires-existing-destination-table',
      reason: 'No people-table template was discovered; do not default people-source import into a company-stage table.',
      tableAlias: null,
      valuePolicy: 'Provide a confirmed people destination table from a live apply/readback artifact before import.',
    };
  }

  const target = matching || tableOutputs[0];
  return {
    status: matching ? 'matched-template-output' : 'defaulted-to-primary-sample-table',
    tableAlias: target.alias,
    tableTemplate: target.template,
    tableName: target.tableName,
    valuePolicy: 'Use live apply/readback artifact IDs; do not write private IDs into playbooks.',
  };
}

function buildWorkflowSequence(playbook, templatePlans) {
  const sourcePlans = templatePlans.filter(plan => plan.kind === 'source');
  const independentSourcePlans = sourcePlans.filter(plan => !plan.inspection?.requiresUpstreamTable && plan.inspection?.sourceType !== 'people');
  const dependentSourcePlans = sourcePlans.filter(plan => plan.inspection?.requiresUpstreamTable || plan.inspection?.sourceType === 'people');
  const tablePlans = templatePlans.filter(plan => plan.kind === 'table');
  const tableOutputs = tablePlans.map(tableOutputAlias);
  const sequence = [];

  sequence.push({
    id: 'validate_all_templates',
    mode: 'offline',
    description: 'Validate every discovered spec template before preparing any live Clay command.',
    commands: templatePlans.flatMap(plan => commandRefs(plan, command => command.id === 'validate_template')),
    produces: ['validated-template-set'],
  });

  if (independentSourcePlans.length) {
    sequence.push({
      id: 'preview_independent_sources',
      mode: 'live-clay',
      confirmationRequired: true,
      description: 'Preview source results that do not depend on an upstream Clay table. This is still a live Clay command and needs exact chat confirmation.',
      commands: independentSourcePlans.flatMap(plan => commandRefs(plan, command => command.id === 'preview_source_sample')),
      produces: ['source-preview-artifacts'],
      stopAfter: 'Review preview quality/counts before source import.',
    });
  }

  if (tablePlans.length) {
    sequence.push({
      id: 'apply_sample_tables',
      mode: 'live-clay',
      confirmationRequired: true,
      description: 'Create sample tables in the confirmed test workbook before importing source rows or running action fields.',
      commands: tablePlans.flatMap(plan => commandRefs(plan, command => command.id === 'apply_sample_spec')),
      produces: tableOutputs,
      stopAfter: 'Save non-simulated apply result artifacts with table/view IDs before continuing.',
    });
  }

  if (independentSourcePlans.length) {
    sequence.push({
      id: 'import_independent_source_samples',
      mode: 'live-clay',
      confirmationRequired: true,
      description: 'Import only the source sample into the matched sample table; never scale import from this step.',
      commands: independentSourcePlans.map(plan => ({
        ...commandRefs(plan, command => command.id === 'import_source_sample')[0],
        destination: sourceDestination(plan, tableOutputs),
      })),
      requires: tablePlans.length ? ['source-preview-artifacts', 'sample-table-apply-results'] : ['source-preview-artifacts', 'operator-supplied-destination-table'],
      stopAfter: 'Read back imported rows before judging source quality.',
    });
  }

  if (independentSourcePlans.length && dependentSourcePlans.length) {
    sequence.push({
      id: 'readback_independent_source_samples',
      mode: 'live-clay-read',
      confirmationRequired: false,
      description: 'Read back company/source sample rows before preparing dependent people-source previews.',
      commands: [
        ...independentSourcePlans.flatMap(plan => commandRefs(plan, command => command.id === 'readback_sample')),
        ...tablePlans.flatMap(plan => commandRefs(plan, command => command.id === 'verify_sample_table' || command.id === 'manifest_readback')),
      ],
      produces: ['upstream-source-readback-artifact'],
      stopAfter: 'Do not preview dependent people sources until upstream sample quality is reviewed.',
    });
  }

  if (dependentSourcePlans.length) {
    sequence.push({
      id: 'preview_dependent_sources',
      mode: 'live-clay',
      confirmationRequired: true,
      description: 'Preview source results that depend on upstream table/view IDs after upstream readback is available.',
      commands: dependentSourcePlans.flatMap(plan => commandRefs(plan, command => command.id === 'preview_source_sample')),
      requires: tablePlans.length ? ['sample-table-apply-results', 'upstream-source-readback-artifact'] : ['operator-supplied-upstream-table'],
      produces: ['dependent-source-preview-artifacts'],
      stopAfter: 'Review dependent source quality/counts before source import.',
    });

    sequence.push({
      id: 'import_dependent_source_samples',
      mode: 'live-clay',
      confirmationRequired: true,
      description: 'Import only dependent source samples into an explicitly matched or operator-supplied destination table.',
      commands: dependentSourcePlans.map(plan => ({
        ...commandRefs(plan, command => command.id === 'import_source_sample')[0],
        destination: sourceDestination(plan, tableOutputs),
      })),
      requires: ['dependent-source-preview-artifacts'],
      stopAfter: 'Read back dependent source rows before judging quality or scale.',
    });
  }

  const runCommands = tablePlans.flatMap(plan => commandRefs(plan, command => command.id.startsWith('run_action_sample_')));
  if (runCommands.length) {
    sequence.push({
      id: 'run_first_action_samples',
      mode: 'live-clay',
      confirmationRequired: true,
      description: 'Run action/AI fields on at most the playbook sample limit after table/source readback looks correct.',
      commands: runCommands,
      sampleRows: {
        max: Math.min(Number(playbook.sampleRows?.max || 10), 10),
        rule: 'Do not scale action rows from this sequence.',
      },
      stopAfter: 'Wait for terminal run status and collect full JSON sample output.',
    });
  }

  const readbackCommands = templatePlans.flatMap(plan => commandRefs(plan, command => command.mode === 'live-clay-read'));
  if (readbackCommands.length) {
    sequence.push({
      id: 'readback_and_verify',
      mode: 'live-clay-read',
      confirmationRequired: false,
      description: 'Use fresh manifest/verify readback as truth; write redacted artifacts for quality reporting.',
      commands: readbackCommands,
      produces: ['verify-artifact', 'redacted-manifest-artifact'],
    });
  }

  const sourceWorkflowRoles = new Set((playbook.workflow || [])
    .filter(step => String(step.type || '').toLowerCase().includes('source') || String(step.id || '').toLowerCase().includes('source'))
    .map(step => templateRole(`${step.id} ${step.type}`))
    .filter(Boolean));
  const templateSourceRoles = new Set(sourcePlans
    .map(plan => templateRole(plan.inspection?.sourceType) || templateRole(path.basename(plan.template, path.extname(plan.template))))
    .filter(Boolean));
  const missingSourceRoles = [...sourceWorkflowRoles].filter(role => !templateSourceRoles.has(role));
  if (missingSourceRoles.length) {
    sequence.push({
      id: 'uncovered_source_workflow_steps',
      mode: 'manual-planning',
      confirmationRequired: false,
      description: `Playbook declares ${missingSourceRoles.join(', ')} source workflow steps but no matching source template was discovered. Add a template or handle manually before claiming the workflow is complete.`,
      missingSourceRoles,
      produces: ['manual-template-gap-note'],
    });
  }

  sequence.push(
    {
      id: 'collect_quality_evidence',
      mode: 'offline',
      confirmationRequired: false,
      description: 'Combine apply, preflight, verify, manifest, and count artifacts into evidence plus a quality report.',
      commands: [
        {
          commandId: 'collect_evidence',
          command: 'node collect-evidence.js --apply <apply-result.json> --verify <verify.json> --manifest <redacted-manifest.json> --out <evidence.json>',
          mode: 'offline',
          confirmationRequired: false,
        },
        {
          commandId: 'write_quality_report',
          command: 'node quality-report.js <plan.json> --evidence <evidence.json> --out <quality-report.md>',
          mode: 'offline',
          confirmationRequired: false,
        },
      ],
      produces: ['evidence-artifact', 'quality-report'],
    },
    {
      id: 'scale_gate',
      mode: 'offline-then-live-confirmation',
      confirmationRequired: true,
      description: 'Generate a scale gate from real evidence, then ask for a second exact-command confirmation before any scale command.',
      commands: [
        {
          commandId: 'scale_gate',
          command: 'node scale-gate.js --plan <plan.json> --evidence <evidence.json> --command "<exact Clay scale command with --confirm>" --quality-reviewed true --out <scale-gate.json>',
          mode: 'offline',
          confirmationRequired: false,
        },
      ],
      requires: ['evidence-artifact', 'quality-report', 'human-quality-review'],
    }
  );

  return {
    status: 'offline-cross-template-sequence',
    playbookId: playbook.id,
    valuePolicy: 'The sequence contains template names, placeholders, command shapes, and artifact requirements only. Runtime IDs and row values are omitted.',
    templateOutputs: tableOutputs,
    steps: sequence,
  };
}

function buildGeneratedSpecPlan(playbook, inputDoc, specPaths) {
  const templatePlans = specPaths.map((specPath, index) => buildTemplatePlan(specPath, playbook, index));
  return {
    status: 'offline-generated-plan',
    valuePolicy: 'Only input keys, template metadata, and commands are emitted. Row values, brief text, payload values, and parameter values are omitted.',
    inputBindings: buildInputBindingPlan(playbook, inputDoc),
    templatePlans,
    workflowSequence: buildWorkflowSequence(playbook, templatePlans),
    qualityLoop: [
      'validate templates offline',
      'get explicit chat confirmation for each live source/apply/run command',
      'build or import sample rows only',
      'read back table/source state',
      'run at most 10 credit-consuming rows',
      'write quality report',
      'scale only after a second explicit confirmation',
    ],
  };
}

function selectTemplatePlan(generatedSpecPlan, selector) {
  const plans = generatedSpecPlan.templatePlans || [];
  const selected = String(selector || '').trim();
  if (!selected) return null;

  if (/^\d+$/.test(selected)) {
    const index = Number(selected) - 1;
    return plans[index] || null;
  }

  return plans.find(plan => plan.template === selected || path.basename(plan.template) === selected) || null;
}

function buildTemplatePlanArtifact(plan, selector) {
  const templatePlan = selectTemplatePlan(plan.generatedSpecPlan || {}, selector);
  if (!templatePlan) {
    const templates = (plan.generatedSpecPlan?.templatePlans || []).map(item => item.template);
    throw new Error(`Template plan not found for "${selector}". Available: ${templates.join(', ') || 'none'}`);
  }

  return {
    artifactVersion: 1,
    mode: 'offline-template-execution-plan',
    generatedAt: new Date().toISOString(),
    playbook: plan.playbook,
    inputSummary: plan.inputSummary,
    safety: plan.safety,
    inputBindings: plan.generatedSpecPlan.inputBindings,
    promptContract: plan.promptContract,
    templatePlan,
    workflowSequence: plan.generatedSpecPlan.workflowSequence,
    firstRunGate: plan.firstRunGate,
    scaleGate: plan.scaleGate,
    qualityLoop: plan.generatedSpecPlan.qualityLoop,
    valuePolicy: plan.generatedSpecPlan.valuePolicy,
  };
}

function buildSampleRunPacketArtifact(plan, selector) {
  const templateArtifact = buildTemplatePlanArtifact(plan, selector);
  const liveCommands = (templateArtifact.templatePlan.commands || []).filter(command => command.mode === 'live-clay');
  const readbackCommands = (templateArtifact.templatePlan.commands || []).filter(command => command.mode === 'live-clay-read');
  const offlineCommands = (templateArtifact.templatePlan.commands || []).filter(command => command.mode === 'offline');

  return {
    artifactVersion: 1,
    mode: 'offline-sample-run-packet',
    generatedAt: new Date().toISOString(),
    playbook: templateArtifact.playbook,
    template: templateArtifact.templatePlan.template,
    sampleBoundary: {
      maxRows: templateArtifact.templatePlan.sampleRows?.max ?? null,
      rule: 'Build/import sample rows only, then stop for readback and quality review before any scale action.',
    },
    runtimeRequirements: [
      { name: 'CLAY_WORKSPACE_ID', required: true, expected: 'workspace allowed by the selected local profile' },
      { name: 'CLAY_TEST_FOLDER_ID', required: true, expected: 'test/scratch folder allowed by the selected local profile' },
      { name: 'CLAY_WORKBOOK_ID', required: templateArtifact.templatePlan.kind === 'table', expected: 'workbook created or selected inside the allowed test folder' },
    ],
    preflightChecks: [
      'confirm the run is inside the allowed workspace for the selected local profile',
      'confirm the workbook is inside the allowed test folder before apply-spec',
      'confirm every live command individually in chat before execution',
      'confirm sample row max is 10 or fewer',
    ],
    valuePolicy: templateArtifact.valuePolicy,
    inputSummary: templateArtifact.inputSummary,
    inputBindings: templateArtifact.inputBindings,
    promptContract: templateArtifact.promptContract,
    safety: templateArtifact.safety,
    workflowSequence: templateArtifact.workflowSequence,
    offlineCommands,
    liveCommands,
    readbackCommands,
    confirmationPrompts: liveCommands.map(command => ({
      commandId: command.id,
      command: command.command,
      prompt: `Confirm this exact Clay command before execution: ${command.command}`,
    })),
    qualityReport: {
      command: 'node quality-report.js <plan.json> --out runs/<date>/<playbook-id>-sample-quality-report.md',
      firstRunGate: templateArtifact.firstRunGate,
      scaleGate: templateArtifact.scaleGate,
    },
    stopConditions: [
      'missing required inputs',
      'template validation fails',
      'user does not confirm the exact live command',
      'sample readback shows settings errors',
      'first-run quality gate fails',
    ],
    nextAfterSuccess: 'Ask for a second explicit confirmation before any scale beyond the sample.',
  };
}

function commandForStep(step) {
  const type = String(step.type || 'manual');
  const id = String(step.id || '').toLowerCase();
  const lowerType = type.toLowerCase();
  const sourceLike = lowerType.includes('source') || lowerType.includes('webhook');
  if (type.includes('source-preview')) return 'node clay-v2.js source-preview <source-spec.yaml>';
  if (type.includes('source-import')) return 'node clay-v2.js source-import <source-spec.yaml> --destination-table <table> --confirm';
  if (sourceLike || (id.includes('resolution') && !lowerType.includes('local'))) return 'node clay-v2.js source-preview <source-spec.yaml> && node clay-v2.js source-import <source-spec.yaml> --destination-table <table> --confirm';
  if (type.includes('use-ai') || type.includes('provider-action') || type === 'actions') return 'node clay-v2.js run-top <table> --field <field> --view <view> --n 10 --confirm';
  if (type === 'manifest') return 'node clay-v2.js manifest <table> --view <view> --include-rows 10 --out <redacted.json>';
  if (type === 'verify') return 'node clay-v2.js verify-table <table> --view <view> --include-rows 10';
  if (type === 'diff') return 'node clay-v2.js diff-spec <spec.yaml> --table <table> --view <view>';
  if (type === 'gated-apply') return 'node clay-v2.js apply-spec <spec.yaml> --workspace <workspace> --folder <test-folder> --workbook <workbook> --confirm';
  if (type === 'http-api') return 'node clay-v2.js run-top <table> --field <http-field> --view <view> --n 1 --confirm';
  return 'offline/local step; translate to formulas/spec fields before live build';
}

function buildPlan(playbook, inputDoc = {}, opts = {}) {
  const sampleMax = Number(playbook.sampleRows?.max || 10);
  const inputSummary = summarizeInputs(playbook, inputDoc);
  const explicitSpecs = opts.specs || (opts.spec ? [opts.spec] : []);
  const specPaths = explicitSpecs.length ? explicitSpecs : discoverSpecTemplates(playbook.id);
  const promptContract = inspectPromptContract(opts.prompt || discoverPromptContract(playbook.id));

  return {
    planVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'offline-playbook-plan',
    playbook: {
      id: playbook.id,
      name: playbook.name,
      status: playbook.status,
      purpose: playbook.purpose,
    },
    inputSummary,
    promptContract,
    variables: playbook.variables || {},
    sampleRows: {
      max: sampleMax,
      recommended: playbook.sampleRows?.recommended || sampleMax,
      reason: playbook.sampleRows?.reason,
    },
    safety: {
      requiresChatConfirmation: playbook.safety?.requiresChatConfirmation || [],
      creditConsumingSteps: playbook.safety?.creditConsumingSteps || [],
      readOnlySteps: playbook.safety?.readOnlySteps || [],
      liveBoundary: {
        workspace: '${CLAY_WORKSPACE_ID}',
        testFolder: '${CLAY_TEST_FOLDER_ID}',
        note: 'Map these through an ignored local profile; do not hardcode private workspace or folder IDs in reusable artifacts.',
      },
      hardRules: [
        'No live Clay write/import/run without explicit chat confirmation for that exact command.',
        'Run at most 10 sample rows before scale.',
        'Use fresh readback and verification before recommending scale.',
        'Do not include secret values or client row data in committed artifacts.',
      ],
    },
    offlinePreparation: [
      {
        id: 'validate_playbook',
        command: 'npm run test:playbooks',
      },
      {
        id: 'validate_prompt_contracts',
        command: 'npm run test:prompts',
      },
      ...specPaths.map((specPath, index) => ({
        id: `validate_spec_template_${index + 1}`,
        command: `node clay-v2.js validate-spec ${specPath}`,
      })),
    ],
    executionPhases: (playbook.workflow || []).map((step, index) => {
      const confirmations = playbook.safety?.requiresChatConfirmation || [];
      const creditSteps = playbook.safety?.creditConsumingSteps || [];
      const type = String(step.type || '').toLowerCase();
      const id = String(step.id || '').toLowerCase();
      const localLike = type.includes('local') || type.includes('formula') || type === 'qa' || type === 'verify' || type === 'manifest' || type === 'diff';
      const sourceLike = type.includes('source') || type.includes('webhook') || ((id.includes('source') || id.includes('resolution')) && !localLike);
      const scaleLike = type.includes('scale') || id.includes('scale');
      const actionLike = type.includes('use-ai')
        || type.includes('action')
        || type.includes('http-api')
        || type.includes('webhook')
        || type === 'actions'
        || type === 'gated-apply';
      const confirmationRequired = creditSteps.includes(step.id)
        || sourceLike
        || scaleLike
        || actionLike
        || confirmations.some(item => {
        const haystack = `${step.id} ${step.type}`.toLowerCase();
        return haystack.includes(String(item).replace(/-/g, '_').toLowerCase()) || haystack.includes(String(item).toLowerCase());
      });
      return {
        order: index + 1,
        id: step.id,
        type: step.type,
        description: step.description || null,
        runCondition: step.runCondition || null,
        outputs: step.outputs || [],
        promptContract: step.promptContract || null,
        commandIntent: commandForStep(step),
        confirmationRequired,
      };
    }),
    firstRunGate: playbook.firstRunGate || null,
    scaleGate: playbook.scaleGate || {
      require: [
        'sampleRowsBuiltOrImported',
        'firstRunGatePassed',
        'qualityReportWritten',
        'userConfirmedScale',
      ],
    },
    outputs: playbook.outputs || {},
    specTemplates: specPaths,
    generatedSpecPlan: buildGeneratedSpecPlan(playbook, inputDoc, specPaths),
    knownFailureModes: playbook.knownFailureModes || [],
    recommendationTemplate: {
      decision: 'continue | stop | revise',
      requiredEvidence: [
        'sample row count',
        'run status counts',
        'full JSON sample artifact path',
        'QA view/readback summary',
        'manual review findings',
      ],
    },
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const playbookFile = flags._[0];
  if (!playbookFile || flags.help) {
    console.log('Usage: node plan-playbook.js <playbook.yaml> [--inputs input.yaml] [--spec spec.yaml] [--specs a.yaml,b.yaml] [--template-plan spec.yaml|basename|index] [--sample-run spec.yaml|basename|index] [--out plan.yaml|json] [--json]');
    return;
  }

  const playbook = readStructured(playbookFile);
  const inputDoc = flags.inputs ? readStructured(flags.inputs) : {};
  const specs = flags.specs ? String(flags.specs).split(',').filter(Boolean) : null;
  const plan = buildPlan(playbook, inputDoc, { spec: flags.spec, specs, prompt: flags.prompt });
  let outputData = plan;
  if (flags['template-plan']) outputData = buildTemplatePlanArtifact(plan, flags['template-plan']);
  if (flags['sample-run']) outputData = buildSampleRunPacketArtifact(plan, flags['sample-run']);

  if (flags.out) {
    const result = writeStructured(outputData, flags.out);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (flags.json) process.stdout.write(JSON.stringify(outputData, null, 2) + '\n');
  else process.stdout.write(formatStructured(outputData));
}

if (require.main === module) main();

module.exports = {
  buildGeneratedSpecPlan,
  buildInputBindingPlan,
  buildPlan,
  buildSampleRunPacketArtifact,
  buildTemplatePlan,
  buildTemplatePlanArtifact,
  buildWorkflowSequence,
  collectDeclaredInputs,
  collectProvidedInputKeys,
  collectRequiredInputs,
  commandForStep,
  discoverSpecTemplates,
  discoverPromptContract,
  formatStructured,
  inspectPromptContract,
  inspectTemplate,
  parseArgs,
  readStructured,
  selectTemplatePlan,
  summarizeInputs,
  writeStructured,
};

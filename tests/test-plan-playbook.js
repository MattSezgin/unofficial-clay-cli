#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = path.join(__dirname, '..');
const playbooksDir = path.join(root, 'playbooks');
const examplesDir = path.join(root, 'examples');

function parseAnswerSchemaFormulaMap(formulaMap) {
  assert.strictEqual(formulaMap.jsonType, '"JSONSchema"');
  assert(formulaMap.jsonSchema, 'expected JSON Schema output format');
  const once = JSON.parse(formulaMap.jsonSchema);
  return typeof once === 'string' ? JSON.parse(once) : once;
}

try {
  execFileSync(process.execPath, [
    path.join(root, 'clay-v2.js'),
    'source-preview',
    path.join(root, 'specs', 'templates', 'people-from-companies-company-source.yaml'),
  ], { encoding: 'utf8', stdio: 'pipe' });
  assert.fail('source-preview without --confirm should fail before auth/network');
} catch (error) {
  assert.strictEqual(error.status, 2);
  assert(String(error.stderr).includes('requires_confirm') || String(error.stderr).includes('requires confirm'));
}

// apply-spec --dry-run still enforces the env-driven write-scope guard, so
// pin a synthetic workspace/folder scope for this hermetic subprocess call.
const applyScopeEnv = { CLAY_WORKSPACE_ID: 'TEST_WS', CLAY_FOLDER_ID: 'f_TEST_FOLDER' };
const applyDryRun = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'clay-v2.js'),
  'apply-spec',
  path.join(root, 'specs', 'templates', 'outbound-personalization.yaml'),
  '--workspace',
  'TEST_WS',
  '--workbook',
  'wb_TEST_WORKBOOK',
  '--folder',
  'f_TEST_FOLDER',
  '--dry-run',
], { encoding: 'utf8', env: applyScopeEnv }));
assert.strictEqual(applyDryRun.dryRun, true);
assert.strictEqual(applyDryRun.workspaceId, 'TEST_WS');
assert.strictEqual(applyDryRun.folderId, 'f_TEST_FOLDER');
assert.strictEqual(applyDryRun.workbookId, 'wb_TEST_WORKBOOK');
assert.strictEqual(applyDryRun.tableName, 'outbound-personalization-sample');
assert.strictEqual(applyDryRun.wouldCreateTable, true);
assert(applyDryRun.fieldCount > 0);
assert.strictEqual(applyDryRun.rowCount, 1);
const applyUseAiSchema = applyDryRun.actionSchemas.find(schema => schema.field === 'AI Personalization');
assert(applyUseAiSchema, 'apply dry-run should summarize AI Personalization schema');
assert.strictEqual(applyUseAiSchema.actionKey, 'use-ai');
assert.deepStrictEqual(applyUseAiSchema.outputFields, [
  'segment',
  'why_this_account',
  'opener_angle',
  'email_angle',
  'confidence_score',
  'risk_flag',
]);
assert(!applyUseAiSchema.outputFields.includes('response'));
assert.strictEqual(parseAnswerSchemaFormulaMap(applyUseAiSchema.answerSchemaBinding.formulaMap).properties.segment.type, 'string');

try {
  execFileSync(process.execPath, [
    path.join(root, 'clay-v2.js'),
    'apply-spec',
    path.join(root, 'specs', 'templates', 'outbound-personalization.yaml'),
    '--workspace',
    'TEST_WS',
    '--workbook',
    'wb_TEST_WORKBOOK',
    '--folder',
    'f_WRONG_FOLDER',
    '--dry-run',
  ], { encoding: 'utf8', stdio: 'pipe', env: applyScopeEnv });
  assert.fail('apply-spec dry-run should reject a non-approved folder before auth/network');
} catch (error) {
  assert.strictEqual(error.status, 1);
  assert(String(error.stderr).includes('approved folders'));
}

const outputSchemaDryRun = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'clay-v2.js'),
  'update-field',
  't_TEST_SAMPLE_TABLE',
  '--field',
  'f_TEST_USE_AI',
  '--outputs',
  'category:text:category,reason:text:reason',
  '--dry-run',
], { encoding: 'utf8', env: {} }));
assert.strictEqual(outputSchemaDryRun.dryRun, true);
assert.strictEqual(outputSchemaDryRun.outputFormat, 'JSON Schema');
assert.deepStrictEqual(Object.keys(outputSchemaDryRun.outputJsonSchema.properties), ['category', 'reason']);
assert.deepStrictEqual(outputSchemaDryRun.outputJsonSchema.required, ['category', 'reason']);
assert(!Object.keys(outputSchemaDryRun.outputJsonSchema.properties).includes('response'));
assert.strictEqual(parseAnswerSchemaFormulaMap(outputSchemaDryRun.answerSchemaBinding.formulaMap).properties.category.type, 'string');

const createUseAiDryRun = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'clay-v2.js'),
  'create-field',
  't_TEST_SAMPLE_TABLE',
  '--name',
  'Use AI Schema Probe',
  '--type',
  'use-ai',
  '--prompt',
  '"Return category and reason for "+{{Company Name}}',
  '--model',
  'clay-argon',
  '--useCase',
  'claygent',
  '--outputs',
  'category:text:category,reason:text:reason',
  '--dry-run',
], { encoding: 'utf8', env: {} }));
assert.strictEqual(createUseAiDryRun.dryRun, true);
assert.strictEqual(createUseAiDryRun.request.method, 'POST');
assert.strictEqual(createUseAiDryRun.request.path, '/v3/tables/t_TEST_SAMPLE_TABLE/fields');
const createUseAiBindings = createUseAiDryRun.request.body.typeSettings.inputsBinding;
const createUseAiSchema = createUseAiBindings.find(binding => binding.name === 'answerSchemaType');
assert(createUseAiSchema, 'create-field use-ai dry-run should include answerSchemaType');
assert.deepStrictEqual(Object.keys(parseAnswerSchemaFormulaMap(createUseAiSchema.formulaMap).properties), ['category', 'reason']);
assert(!JSON.stringify(createUseAiSchema).includes('"response"'), 'create-field use-ai schema should not default to response');

const fixtureDir = path.join(root, 'runs', 'test-template-plan');
fs.mkdirSync(fixtureDir, { recursive: true });
const schemaPassManifest = path.join(fixtureDir, 'schema-verify-pass.json');
const schemaResponseOnlyManifest = path.join(fixtureDir, 'schema-verify-response-only.json');
fs.writeFileSync(schemaPassManifest, JSON.stringify({
  table: {
    id: 't_TEST_SAMPLE_TABLE',
    name: 'schema pass fixture',
    fields: [{
      id: 'f_TEST_USE_AI',
      name: 'Use AI Schema Probe',
      type: 'action',
      typeSettings: {
        actionKey: 'use-ai',
        inputsBinding: [
          { name: 'answerSchemaType', formulaMap: { type: '"json"', fields: JSON.stringify({ category: { type: 'string' }, reason: { type: 'string' } }) }, optional: true },
        ],
      },
    }],
  },
}, null, 2));
fs.writeFileSync(schemaResponseOnlyManifest, JSON.stringify({
  table: {
    id: 't_TEST_SAMPLE_TABLE',
    name: 'schema response-only fixture',
    fields: [{
      id: 'f_TEST_USE_AI',
      name: 'Use AI Schema Probe',
      type: 'action',
      typeSettings: {
        actionKey: 'use-ai',
        inputsBinding: [
          { name: 'answerSchemaType', formulaMap: { type: '"json"', fields: JSON.stringify({ response: { type: 'string' } }) }, optional: true },
        ],
      },
    }],
  },
}, null, 2));

const schemaVerifyPass = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'clay-v2.js'),
  'verify-field-output-schema',
  't_TEST_SAMPLE_TABLE',
  '--field',
  'f_TEST_USE_AI',
  '--outputs',
  'category:text:category,reason:text:reason',
  '--from-manifest',
  schemaPassManifest,
], { encoding: 'utf8', env: {} }));
assert.strictEqual(schemaVerifyPass.valid, true);
assert.deepStrictEqual(Object.keys(schemaVerifyPass.actual), ['category', 'reason']);
assert.deepStrictEqual(schemaVerifyPass.missing, []);
assert.strictEqual(schemaVerifyPass.hasDefaultResponseOnly, false);

const schemaVerifyResponseOnly = JSON.parse(execFileSync(process.execPath, [
  path.join(root, 'clay-v2.js'),
  'verify-field-output-schema',
  't_TEST_SAMPLE_TABLE',
  '--field',
  'f_TEST_USE_AI',
  '--outputs',
  'category:text:category,reason:text:reason',
  '--from-manifest',
  schemaResponseOnlyManifest,
], { encoding: 'utf8', env: {} }));
assert.strictEqual(schemaVerifyResponseOnly.valid, false);
assert.deepStrictEqual(schemaVerifyResponseOnly.missing, ['category', 'reason']);
assert.strictEqual(schemaVerifyResponseOnly.hasDefaultResponseOnly, true);
assert(schemaVerifyResponseOnly.issues.some(issue => issue.type === 'default_response_only'));

const output = execFileSync(process.execPath, [
  path.join(root, 'lib', 'plan-playbook.js'),
  path.join(root, 'playbooks', 'outbound-personalization.yaml'),
  '--inputs',
  path.join(root, 'examples', 'outbound-personalization-input.example.yaml'),
  '--spec',
  'specs/templates/outbound-personalization.yaml',
  '--json',
], { encoding: 'utf8' });

const plan = JSON.parse(output);

assert.strictEqual(plan.mode, 'offline-playbook-plan');
assert.strictEqual(plan.playbook.id, 'outbound-personalization');
assert.strictEqual(plan.inputSummary.readyForSamplePlan, true);
assert.strictEqual(plan.inputSummary.missingRequired.length, 0);
assert.strictEqual(plan.promptContract.id, 'outbound-personalization');
assert.strictEqual(plan.promptContract.file, 'prompts/outbound-personalization.yaml');
assert.strictEqual(plan.promptContract.valuesIncluded, false);
assert(plan.promptContract.guardrails.some(rule => rule.includes('invent')));
assert(plan.promptContract.outputFields.includes('email_angle'));
assert(plan.sampleRows.max <= 10, 'sample row max must stay <= 10');
assert(plan.offlinePreparation.some(step => step.command.includes('validate-spec specs/templates/outbound-personalization.yaml')));
assert(plan.offlinePreparation.some(step => step.command === 'npm run test:prompts'));
assert(plan.specTemplates.includes('specs/templates/outbound-personalization.yaml'));
assert(plan.generatedSpecPlan, 'expected generatedSpecPlan');
assert.strictEqual(plan.generatedSpecPlan.workflowSequence.status, 'offline-cross-template-sequence');
assert(plan.generatedSpecPlan.workflowSequence.steps.some(step => step.id === 'apply_sample_tables'));
assert(plan.generatedSpecPlan.workflowSequence.steps
  .filter(step => step.mode === 'live-clay')
  .every(step => step.confirmationRequired && step.commands.every(command => command.confirmationRequired)));
assert(plan.generatedSpecPlan.templatePlans.some(template => template.template === 'specs/templates/outbound-personalization.yaml'));
assert(plan.generatedSpecPlan.templatePlans[0].commands.some(command => command.id === 'apply_sample_spec' && command.confirmationRequired));
assert(plan.generatedSpecPlan.templatePlans[0].commands.some(command => command.id === 'apply_sample_spec' && command.command.includes('--workspace') && command.command.includes('--folder') && command.command.includes('--workbook')));
assert(plan.generatedSpecPlan.templatePlans[0].commands.some(command => command.id === 'run_action_sample_1' && command.command.includes('run-top') && command.confirmationRequired));
assert(plan.executionPhases.some(step => step.id === 'ai_personalization'));
assert.strictEqual(plan.executionPhases.find(step => step.id === 'ai_personalization').confirmationRequired, true);
assert(plan.safety.hardRules.some(rule => rule.includes('No live Clay write')));
assert(!output.includes('Example Co'), 'plan output should not include row values');

const artifactOut = path.join(root, 'runs', 'test-template-plan', 'outbound-personalization-template-plan.json');
const artifactWrite = execFileSync(process.execPath, [
  path.join(root, 'lib', 'plan-playbook.js'),
  path.join(root, 'playbooks', 'outbound-personalization.yaml'),
  '--inputs',
  path.join(root, 'examples', 'outbound-personalization-input.example.yaml'),
  '--template-plan',
  'outbound-personalization.yaml',
  '--out',
  artifactOut,
], { encoding: 'utf8' });
assert(JSON.parse(artifactWrite).wrote.endsWith('outbound-personalization-template-plan.json'));
const artifact = JSON.parse(fs.readFileSync(artifactOut, 'utf8'));
assert.strictEqual(artifact.mode, 'offline-template-execution-plan');
assert.strictEqual(artifact.playbook.id, 'outbound-personalization');
assert.strictEqual(artifact.promptContract.id, 'outbound-personalization');
assert.strictEqual(artifact.promptContract.valuesIncluded, false);
assert.strictEqual(artifact.templatePlan.template, 'specs/templates/outbound-personalization.yaml');
assert.strictEqual(artifact.workflowSequence.status, 'offline-cross-template-sequence');
assert(artifact.templatePlan.commands.some(command => command.id === 'apply_sample_spec' && command.mode === 'live-clay' && command.confirmationRequired));
assert(artifact.templatePlan.commands.some(command => command.id === 'apply_sample_spec' && command.command.includes('--workspace') && command.command.includes('--folder') && command.command.includes('--workbook')));
assert(artifact.inputBindings.filter(input => input.required).every(input => input.provided));
assert(!JSON.stringify(artifact).includes('Example Co'), 'template plan artifact should not include row values');

const sampleRunOut = path.join(root, 'runs', 'test-template-plan', 'outbound-personalization-sample-run.json');
const sampleRunWrite = execFileSync(process.execPath, [
  path.join(root, 'lib', 'plan-playbook.js'),
  path.join(root, 'playbooks', 'outbound-personalization.yaml'),
  '--inputs',
  path.join(root, 'examples', 'outbound-personalization-input.example.yaml'),
  '--sample-run',
  'outbound-personalization.yaml',
  '--out',
  sampleRunOut,
], { encoding: 'utf8' });
assert(JSON.parse(sampleRunWrite).wrote.endsWith('outbound-personalization-sample-run.json'));
const sampleRunPacket = JSON.parse(fs.readFileSync(sampleRunOut, 'utf8'));
assert.strictEqual(sampleRunPacket.mode, 'offline-sample-run-packet');
assert.strictEqual(sampleRunPacket.promptContract.id, 'outbound-personalization');
assert.strictEqual(sampleRunPacket.promptContract.valuesIncluded, false);
assert(sampleRunPacket.promptContract.qaChecks.length >= 2);
assert.strictEqual(sampleRunPacket.workflowSequence.status, 'offline-cross-template-sequence');
assert(sampleRunPacket.runtimeRequirements.some(item => item.name === 'CLAY_WORKSPACE_ID' && item.required));
assert(sampleRunPacket.runtimeRequirements.some(item => item.name === 'CLAY_TEST_FOLDER_ID' && item.required));
assert(sampleRunPacket.runtimeRequirements.some(item => item.name === 'CLAY_WORKBOOK_ID' && item.required));
assert(sampleRunPacket.preflightChecks.some(item => item.includes('allowed test folder')));
assert(sampleRunPacket.liveCommands.some(command => command.id === 'apply_sample_spec' && command.confirmationRequired));
assert(sampleRunPacket.liveCommands.some(command => command.id === 'apply_sample_spec' && command.command.includes('--workspace') && command.command.includes('--folder') && command.command.includes('--workbook')));
assert(sampleRunPacket.liveCommands.some(command => command.id === 'run_action_sample_1' && command.command.includes('run-top') && command.confirmationRequired));
assert(sampleRunPacket.confirmationPrompts.every(prompt => prompt.prompt.includes('Confirm this exact Clay command')));
assert(sampleRunPacket.readbackCommands.some(command => command.id === 'verify_sample_table'));
assert(!JSON.stringify(sampleRunPacket).includes('Example Co'), 'sample-run packet should not include row values');

const peopleOutput = execFileSync(process.execPath, [
  path.join(root, 'lib', 'plan-playbook.js'),
  path.join(root, 'playbooks', 'people-from-companies.yaml'),
  '--json',
], { encoding: 'utf8' });
const peoplePlan = JSON.parse(peopleOutput);
assert(peoplePlan.specTemplates.includes('specs/templates/people-from-companies-company-stage.yaml'));
assert(peoplePlan.specTemplates.includes('specs/templates/people-from-companies-company-source.yaml'));
assert(peoplePlan.specTemplates.includes('specs/templates/people-from-companies-people-source.yaml'));
assert(peoplePlan.generatedSpecPlan.templatePlans
  .filter(template => template.kind === 'source')
  .every(template => template.commands.some(command => command.id === 'preview_source_sample' && command.command.includes('--confirm'))));
const peopleSequence = peoplePlan.generatedSpecPlan.workflowSequence;
assert.strictEqual(peopleSequence.status, 'offline-cross-template-sequence');
assert.deepStrictEqual(peopleSequence.steps.map(step => step.id).slice(0, 4), [
  'validate_all_templates',
  'preview_independent_sources',
  'apply_sample_tables',
  'import_independent_source_samples',
]);
const peopleIndependentImportStep = peopleSequence.steps.find(step => step.id === 'import_independent_source_samples');
const peopleDependentPreviewStep = peopleSequence.steps.find(step => step.id === 'preview_dependent_sources');
const peopleDependentImportStep = peopleSequence.steps.find(step => step.id === 'import_dependent_source_samples');
assert(peopleIndependentImportStep.commands.every(command => command.confirmationRequired), 'independent source imports must require confirmation');
assert(peopleDependentPreviewStep.commands.every(command => command.confirmationRequired), 'dependent source previews must require confirmation');
assert(peopleDependentImportStep.commands.every(command => command.confirmationRequired), 'dependent source imports must require confirmation');
const companySourceImport = peopleIndependentImportStep.commands.find(command => command.template.endsWith('company-source.yaml'));
const peopleSourceImport = peopleDependentImportStep.commands.find(command => command.template.endsWith('people-source.yaml'));
assert.strictEqual(companySourceImport.destination.status, 'matched-template-output');
assert.strictEqual(companySourceImport.destination.tableAlias, 'primary-sample-table');
assert.strictEqual(peopleSourceImport.destination.status, 'requires-existing-destination-table');
assert(peopleDependentPreviewStep.requires.includes('upstream-source-readback-artifact'));
const peopleStepIds = peopleSequence.steps.map(step => step.id);
assert(
  peopleStepIds.indexOf('readback_independent_source_samples') < peopleStepIds.indexOf('preview_dependent_sources'),
  'company-source readback must precede dependent people-source preview'
);
for (const step of peopleSequence.steps.filter(step => step.mode === 'live-clay')) {
  const commandText = JSON.stringify(step.commands || []);
  if (commandText.includes('people-from-companies-company-source.yaml')) {
    assert(!commandText.includes('people-from-companies-people-source.yaml'), `do not batch company-source live commands with people-source live commands in ${step.id}`);
  }
}
assert.strictEqual(peoplePlan.executionPhases.find(step => step.id === 'sample_company_resolution').confirmationRequired, true);
assert.strictEqual(peoplePlan.executionPhases.find(step => step.id === 'scale_company_resolution').confirmationRequired, true);

const sourceReadyOutput = execFileSync(process.execPath, [
  path.join(root, 'lib', 'plan-playbook.js'),
  path.join(root, 'playbooks', 'source-to-ready-list.yaml'),
  '--json',
], { encoding: 'utf8' });
const sourceReadyPlan = JSON.parse(sourceReadyOutput);
assert(sourceReadyPlan.executionPhases.some(step => /people.*source/.test(`${step.id} ${step.type}`)));
assert(!sourceReadyPlan.generatedSpecPlan.templatePlans.some(template => template.kind === 'source' && template.inspection.sourceType === 'people'));
assert(sourceReadyPlan.generatedSpecPlan.workflowSequence.steps.some(step => step.id === 'uncovered_source_workflow_steps' && step.missingSourceRoles.includes('people')));

const playbookFiles = fs.readdirSync(playbooksDir)
  .filter(file => file.endsWith('.yaml'))
  .sort();
const planSummaries = [];

function collectInputValues(value, values = [], pathParts = []) {
  if (value == null) return values;
  if (Array.isArray(value)) {
    for (const item of value) collectInputValues(item, values, pathParts);
    return values;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) collectInputValues(item, values, [...pathParts, key]);
    return values;
  }
  if (pathParts[0] === 'columns' || pathParts[0] === 'quality') return values;
  if (typeof value === 'string' && value.length >= 8 && !value.startsWith('${')) values.push(value);
  return values;
}

for (const file of playbookFiles) {
  const playbookPath = path.join(playbooksDir, file);
  const generated = execFileSync(process.execPath, [
    path.join(root, 'lib', 'plan-playbook.js'),
    playbookPath,
    '--json',
  ], { encoding: 'utf8' });
  const generatedPlan = JSON.parse(generated);

  assert.strictEqual(generatedPlan.mode, 'offline-playbook-plan', `${file}: expected offline plan mode`);
  assert(generatedPlan.generatedSpecPlan, `${file}: expected generatedSpecPlan`);
  assert.strictEqual(generatedPlan.generatedSpecPlan.status, 'offline-generated-plan', `${file}: expected offline generated spec plan`);
  assert.strictEqual(generatedPlan.generatedSpecPlan.workflowSequence.status, 'offline-cross-template-sequence', `${file}: expected workflow sequence`);
  assert(generatedPlan.sampleRows.max <= 10, `${file}: sample row max must stay <= 10`);
  assert(generatedPlan.specTemplates.length > 0, `${file}: expected at least one discovered spec template`);
  assert.strictEqual(generatedPlan.generatedSpecPlan.templatePlans.length, generatedPlan.specTemplates.length, `${file}: expected one template plan per spec template`);
  assert(generatedPlan.generatedSpecPlan.qualityLoop.some(step => step.includes('scale only after')), `${file}: expected scale gate in generated spec plan`);
  assert(generatedPlan.offlinePreparation.some(step => step.command === 'npm run test:playbooks'), `${file}: expected playbook validation step`);
  assert(generatedPlan.offlinePreparation.some(step => step.command === 'npm run test:prompts'), `${file}: expected prompt validation step`);
  assert.strictEqual(generatedPlan.promptContract?.status, 'present', `${file}: expected prompt contract`);
  assert.strictEqual(generatedPlan.promptContract?.playbookId, generatedPlan.playbook.id, `${file}: prompt contract should match playbook`);
  assert.strictEqual(generatedPlan.promptContract?.valuesIncluded, false, `${file}: prompt contract should omit runtime values`);
  assert((generatedPlan.promptContract?.guardrails || []).length >= 3, `${file}: prompt contract should include guardrails`);
  assert((generatedPlan.promptContract?.outputFields || []).length >= 3, `${file}: prompt contract should include output fields`);

  for (const specPath of generatedPlan.specTemplates) {
    assert(fs.existsSync(path.join(root, specPath)), `${file}: missing discovered template ${specPath}`);
    assert(specPath.startsWith('specs/templates/'), `${file}: template path must stay under specs/templates`);
  }

  for (const templatePlan of generatedPlan.generatedSpecPlan.templatePlans) {
    assert(templatePlan.commands.some(command => command.id === 'validate_template' && command.mode === 'offline'), `${file}: template plan must include offline validation`);
    const liveCommands = templatePlan.commands.filter(command => command.mode === 'live-clay');
    assert(liveCommands.length > 0, `${file}: template plan should include live sample commands`);
    assert(liveCommands.every(command => command.confirmationRequired), `${file}: live sample commands must require confirmation`);
    assert(templatePlan.sampleRows.max <= 10, `${file}: template sample rows must stay <= 10`);
  }

  const liveSequenceSteps = generatedPlan.generatedSpecPlan.workflowSequence.steps.filter(step => step.mode === 'live-clay');
  assert(liveSequenceSteps.every(step => step.confirmationRequired), `${file}: live workflow sequence steps must require confirmation`);
  assert(liveSequenceSteps.every(step => step.commands.every(command => command.confirmationRequired)), `${file}: live workflow sequence commands must require confirmation`);
  assert(generatedPlan.generatedSpecPlan.workflowSequence.steps.some(step => step.id === 'collect_quality_evidence'), `${file}: expected quality evidence sequence step`);
  assert(generatedPlan.generatedSpecPlan.workflowSequence.steps.some(step => step.id === 'scale_gate'), `${file}: expected scale gate sequence step`);

  const sourceOrRunPhases = generatedPlan.executionPhases.filter(step => {
    const idAndType = `${step.id} ${step.type}`.toLowerCase();
    const commandIntent = String(step.commandIntent || '').toLowerCase();
    return commandIntent.includes('source-preview')
      || commandIntent.includes('source-import')
      || commandIntent.includes('run-top')
      || commandIntent.includes('apply-spec')
      || idAndType.includes('scale');
  });
  assert(sourceOrRunPhases.every(step => step.confirmationRequired), `${file}: source/run/scale phases must require confirmation`);

  planSummaries.push({
    playbook: generatedPlan.playbook.id,
    templates: generatedPlan.specTemplates.length,
    phases: generatedPlan.executionPhases.length,
  });

  const examplePath = path.join(examplesDir, `${generatedPlan.playbook.id}-input.example.yaml`);
  assert(fs.existsSync(examplePath), `${file}: expected example input ${path.basename(examplePath)}`);

  const generatedWithExample = execFileSync(process.execPath, [
    path.join(root, 'lib', 'plan-playbook.js'),
    playbookPath,
    '--inputs',
    examplePath,
    '--json',
  ], { encoding: 'utf8' });
  const planWithExample = JSON.parse(generatedWithExample);
  assert.strictEqual(planWithExample.inputSummary.readyForSamplePlan, true, `${file}: example input should satisfy required inputs`);
  assert.deepStrictEqual(planWithExample.inputSummary.missingRequired, [], `${file}: example input should not miss required inputs`);
  assert(planWithExample.generatedSpecPlan.inputBindings.some(input => input.required), `${file}: expected required input bindings`);
  assert(planWithExample.generatedSpecPlan.inputBindings.filter(input => input.required).every(input => input.provided), `${file}: required input bindings should be provided`);

  const exampleDoc = YAML.parse(fs.readFileSync(examplePath, 'utf8'));
  for (const inputValue of collectInputValues(exampleDoc)) {
    if (inputValue === generatedPlan.playbook.id) continue;
    assert(!generatedWithExample.includes(inputValue), `${file}: plan output should not include example input value "${inputValue}"`);
  }
}

console.log(JSON.stringify({ ok: true, checked: 'playbook-plan', plans: planSummaries }, null, 2));

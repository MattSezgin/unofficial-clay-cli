#!/usr/bin/env node

const assert = require('assert');
const { buildProofPacketFromManifest, suggestExtractedOutputPaths, valueMatchesShape, enumValueQaChecks, semanticContradictionChecks, isCompatibleUseAiModelPair, buildSafeModelMatrixProbePlan, validateSafeModelMatrixProbeResult } = require('../lib/proof-harness');

// Hermetic synthetic manifest shaped like a real "enrich company" action
// readback - no dependency on a private/local runs/ proof-run artifact.
const PARENT_FIELD_ID = 'f_TEST_MIXRANK_PARENT';
const OUTPUT_FIELDS = [
  { id: 'f_TEST_OUT_NAME', name: 'Mixrank Company Name', path: ['name'] },
  { id: 'f_TEST_OUT_LINKEDIN', name: 'Mixrank Company LinkedIn URL', path: ['url'] },
  { id: 'f_TEST_OUT_DOMAIN', name: 'Mixrank Company Domain', path: ['domain'] },
  { id: 'f_TEST_OUT_EMPLOYEES', name: 'Mixrank Employee Count', path: ['employee_count'] },
  { id: 'f_TEST_OUT_INDUSTRY', name: 'Mixrank Industry', path: ['industry'] },
  { id: 'f_TEST_OUT_FOUNDED', name: 'Mixrank Founded Year', path: ['founded_year'] },
];

function fullValueFor(index) {
  return {
    name: `Test Company ${index}`,
    url: `https://www.linkedin.com/company/test-company-${index}`,
    domain: `test-company-${index}.com`,
    employee_count: 50 + index,
    industry: 'Software',
    founded_year: 2010 + index,
  };
}

function buildManifest() {
  const table = {
    id: 't_TEST_MIXRANK_TABLE',
    workspaceId: 'TEST_WS',
    workbookId: 'wb_TEST_WORKBOOK',
    fields: [
      {
        id: PARENT_FIELD_ID,
        name: 'Mixrank Enrichment',
        type: 'action',
        typeSettings: {
          actionKey: 'enrich-company-with-mixrank-v2',
          actionPackageId: 'e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2',
          actionVersion: 1,
          inputsBinding: [],
        },
        inputFieldIds: [],
      },
      ...OUTPUT_FIELDS.map(field => ({
        id: field.id,
        name: field.name,
        type: 'formula',
        inputFieldIds: [PARENT_FIELD_ID],
        typeSettings: { mappedResultPath: field.path },
      })),
    ],
  };
  const records = Array.from({ length: 10 }, (_, i) => {
    const fullValue = fullValueFor(i);
    const cells = {
      [PARENT_FIELD_ID]: { externalContent: { status: 'SUCCESS', fullValue } },
    };
    for (const field of OUTPUT_FIELDS) {
      cells[field.id] = { value: fullValue[field.path[0]] };
    }
    return { id: `r_TEST_${i}`, cells };
  });
  return { table, records };
}

const manifest = buildManifest();
const result = buildProofPacketFromManifest(manifest, {
  fieldId: PARENT_FIELD_ID,
  viewId: 'gv_TEST_VIEW',
  rowLimit: 10,
  artifacts: ['runs/test/synthetic-mixrank-manifest.json'],
});
assert.strictEqual(result.validation.valid, true, JSON.stringify(result.validation.issues, null, 2));
assert.strictEqual(result.packet.outcome, 'passed');
assert.strictEqual(result.packet.actionKey, 'enrich-company-with-mixrank-v2');
assert.strictEqual(result.packet.parentOutputInspection.rowsWithFullValue, 10);
assert(result.packet.parentOutputInspection.sampleFullValueKeys.includes('name'));
assert(result.packet.extractedOutputs.length >= 6);
assert(result.packet.extractedOutputs.some(output => output.name === 'Mixrank Company Name' && output.nonEmptyCount === 10));
assert(result.packet.extractedOutputs.some(output => output.name === 'Mixrank Company LinkedIn URL' && output.expectedShape === 'url' && output.invalidShapeCount === 0));
const suggestions = suggestExtractedOutputPaths(result.packet.parentOutputInspection.sampleFullValue);
assert(suggestions.some(item => item.path.join('.') === 'name'));
assert(suggestions.some(item => item.path.join('.') === 'url'));
assert.strictEqual(valueMatchesShape('https://www.linkedin.com/company/test', 'url'), true);
assert.strictEqual(valueMatchesShape('not a url', 'url'), false);
assert.strictEqual(valueMatchesShape('person@example.com', 'email'), true);
assert.strictEqual(valueMatchesShape('not-email', 'email'), false);
assert.deepStrictEqual(enumValueQaChecks([{ name: 'Confidence', path: ['confidence'], sampleValues: ['High', 'low'] }], { confidence: ['High', 'Medium', 'Low'] })[0].invalidValues, ['low']);
assert.strictEqual(semanticContradictionChecks([{ linkedin_url: 'NOT_FOUND', confidence: 'high' }])[0].passed, false);
assert.strictEqual(result.packet.strictProofRequirements.parentFullValuePresent, true);
assert.strictEqual(result.packet.strictProofRequirements.extractedValuesVerified, true);
const noRuntimeErrorCheck = result.packet.valueQa.checks.find(check => check.type === 'no_unresolved_runtime_errors');
assert.deepStrictEqual(noRuntimeErrorCheck.unresolvedRuntimeErrors, []);

const noFullValue = JSON.parse(JSON.stringify(manifest));
for (const record of noFullValue.records) {
  const cell = record.cells?.[PARENT_FIELD_ID];
  if (cell?.externalContent) delete cell.externalContent.fullValue;
}
const failed = buildProofPacketFromManifest(noFullValue, { fieldId: PARENT_FIELD_ID, viewId: 'gv_TEST_VIEW', rowLimit: 10 });
assert.strictEqual(failed.packet.outcome, 'failed');
assert.strictEqual(failed.packet.strictProofRequirements.parentFullValuePresent, false);
assert(failed.validation.issues.some(issue => issue.type === 'redaction_not_confirmed') === false);

assert.strictEqual(isCompatibleUseAiModelPair({ model: 'clay-argon', useCase: 'claygent' }), true);
assert.strictEqual(isCompatibleUseAiModelPair({ model: 'clay-argon', useCase: 'use-ai' }), false);
const safePlan = buildSafeModelMatrixProbePlan({ tableId: 't_test', viewId: 'gv_test', fieldId: 'f_ai', model: 'clay-argon', useCase: 'claygent' });
assert.strictEqual(safePlan.rowLimit, 1);
assert.strictEqual(safePlan.watchTimeoutSeconds, 90);
assert(safePlan.commands.some(command => command.includes('--n 1')));
assert(safePlan.commands.some(command => command.includes('--timeout 90')));
assert.throws(() => buildSafeModelMatrixProbePlan({ rowLimit: 2 }), /exactly one row/);
assert.throws(() => buildSafeModelMatrixProbePlan({ watchTimeoutSeconds: 600 }), /<=120 seconds/);
assert.throws(() => buildSafeModelMatrixProbePlan({ model: 'clay-argon', useCase: 'use-ai' }), /incompatible/);
const unsafeGreenExtractedNoParent = JSON.parse(JSON.stringify(failed.packet));
unsafeGreenExtractedNoParent.rowLimit = 1;
unsafeGreenExtractedNoParent.runReadback.checkedRows = 1;
unsafeGreenExtractedNoParent.parentOutputInspection.rowsWithFullValue = 0;
unsafeGreenExtractedNoParent.extractedOutputs = [{ name: 'Looks Green', statusCounts: { SUCCESS: 1 }, nonEmptyCount: 1 }];
const modelProbeValidation = validateSafeModelMatrixProbeResult(unsafeGreenExtractedNoParent);
assert.strictEqual(modelProbeValidation.valid, false);
assert(modelProbeValidation.issues.some(issue => issue.type === 'model_probe_missing_parent_full_value'));
assert(modelProbeValidation.issues.some(issue => issue.type === 'model_probe_extracted_success_without_parent_full_value'));

console.log(JSON.stringify({ ok: true, checked: 'proof-harness' }, null, 2));

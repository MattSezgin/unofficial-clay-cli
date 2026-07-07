#!/usr/bin/env node

const assert = require('assert');
const { buildWorkbookParityAudit, actionKeyFamily } = require('./workbook-parity');

assert.strictEqual(actionKeyFamily('use-ai'), 'ai');
assert.strictEqual(actionKeyFamily('http-api-v2'), 'http_api');
assert.strictEqual(actionKeyFamily('leadmagic-find-work-email'), 'provider');
assert.strictEqual(actionKeyFamily('lookup-row-in-other-table'), 'lookup');

const primitiveFixture = {
  kind: 'clay-workbook-parity-fixture',
  workbookId: 'wb_primitive',
  workspaceId: 'TEST_WS',
  tables: [
    {
      id: 't_primitive',
      name: 'Primitive source table',
      fieldCount: 3,
      viewCount: 1,
      actionFieldCount: 0,
      formulaFieldCount: 0,
      sourceFields: [{ id: 'f_source', name: 'Webhook Source' }],
      actionFields: [],
      formulaFields: [],
      views: [{ id: 'gv_primitive', name: 'Default' }],
    },
  ],
};

const realFixture = {
  kind: 'clay-workbook-parity-fixture',
  workbookId: 'wb_real',
  workspaceId: 'TEST_WS',
  tables: [
    {
      id: 't_real',
      name: 'Real workbook table',
      fieldCount: 12,
      viewCount: 3,
      actionFieldCount: 3,
      formulaFieldCount: 3,
      sourceFields: [],
      actionFields: [
        {
          id: 'f_ai',
          name: 'Attendee LinkedIn Lookup',
          actionKey: 'use-ai',
          actionPackageId: '67ba01e9-1898-4e7d-afe7-7ebe24819a57',
          hasPrompt: true,
          hasJsonSchema: true,
          hasRunCondition: true,
          inputBindingNames: ['useCase', 'prompt', 'answerSchemaType'],
          conditionalRunFormulaText: '!!{{job_title}}',
          typeSettings: {
            actionKey: 'use-ai',
            inputsBinding: [
              { name: 'useCase', formulaText: '"claygent"' },
              { name: 'prompt', formulaText: '"Find the person and return JSON"' },
              { name: 'answerSchemaType', formulaMap: { type: '"json"', fields: '{"linkedin_url":{"type":"string"}}' } },
            ],
            conditionalRunFormulaText: '!!{{job_title}}',
          },
        },
        {
          id: 'f_person',
          name: 'Enrich person',
          actionKey: 'enrich-person-with-mixrank-v2',
          hasPrompt: false,
          hasJsonSchema: true,
          hasRunCondition: true,
          inputBindingNames: ['person_identifier'],
          conditionalRunFormulaText: '!!{{linkedin_url}}',
          typeSettings: { actionKey: 'enrich-person-with-mixrank-v2', conditionalRunFormulaText: '!!{{linkedin_url}}' },
        },
        {
          id: 'f_http',
          name: 'Email verifier',
          actionKey: 'http-api-v2',
          hasPrompt: false,
          hasJsonSchema: true,
          hasRunCondition: true,
          inputBindingNames: ['url'],
          conditionalRunFormulaText: '!!{{email}}',
          typeSettings: { actionKey: 'http-api-v2', conditionalRunFormulaText: '!!{{email}}' },
        },
      ],
      formulaFields: [
        { id: 'f_out', name: 'LinkedIn URL', typeSettings: { mappedResultPath: ['linkedin_url'] } },
        { id: 'f_gate', name: 'Ready?', typeSettings: { formulaText: '!!{{email}}' } },
      ],
      views: [
        { id: 'gv_qa', name: 'QA' },
        { id: 'gv_ready', name: 'Campaign Ready' },
        { id: 'gv_errors', name: 'Errors' },
      ],
    },
  ],
};

const primitiveAudit = buildWorkbookParityAudit(primitiveFixture);
assert.strictEqual(primitiveAudit.status, 'primitive_proof');
assert(primitiveAudit.missing.includes('has_actions'));
assert(primitiveAudit.missing.includes('has_ai_prompt_action'));

const realAudit = buildWorkbookParityAudit(realFixture);
assert.strictEqual(realAudit.status, 'workbook_parity_complete');
assert.strictEqual(realAudit.missing.length, 0);
assert.strictEqual(realAudit.summary.providerActionCount, 1);
assert.strictEqual(realAudit.summary.httpActionCount, 1);
assert.strictEqual(realAudit.summary.promptedActionCount, 1);

const rowRequiredAudit = buildWorkbookParityAudit(realFixture, { requireRows: true });
assert.strictEqual(rowRequiredAudit.status, 'partial_parity');
assert(rowRequiredAudit.missing.includes('has_populated_rows'));

console.log(JSON.stringify({ ok: true, checked: 'workbook-parity' }, null, 2));

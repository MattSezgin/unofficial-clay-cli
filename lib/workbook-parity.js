#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { parseArgs } = require('./plan-playbook');

const ROOT = path.join(__dirname, '..');

function readStructured(file) {
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const text = fs.readFileSync(full, 'utf8');
  if (/\.ya?ml$/i.test(full)) return YAML.parse(text);
  return JSON.parse(text);
}

function actionKeyFamily(actionKey) {
  if (!actionKey) return 'unknown';
  if (actionKey === 'use-ai') return 'ai';
  if (actionKey === 'http-api-v2') return 'http_api';
  if (/lookup.*other-table|lookup-company-in-other-table/.test(actionKey)) return 'lookup';
  if (/enrich|find-work-email|validate-email|find-email|leadmagic|findymail|icypeas|mixrank|apollo|prospeo|smartlead|instantly/.test(actionKey)) return 'provider';
  if (/trigger-find-people-source|source/.test(actionKey)) return 'source_trigger';
  return 'other_action';
}

function flattenActions(fixture) {
  return (fixture.tables || []).flatMap(table => (table.actionFields || []).map(field => ({ ...field, tableId: table.id, tableName: table.name })));
}

function countTablesWithRows(fixture) {
  return (fixture.tables || []).filter(table => Number(table.recordCount || table.rowCount || table.count || 0) > 0).length;
}

function buildWorkbookParityAudit(fixture, opts = {}) {
  const tables = fixture.tables || [];
  const actions = flattenActions(fixture);
  const formulas = tables.flatMap(table => table.formulaFields || []);
  const views = tables.flatMap(table => table.views || []);
  const families = actions.reduce((acc, action) => {
    const family = actionKeyFamily(action.actionKey);
    acc[family] = (acc[family] || 0) + 1;
    return acc;
  }, {});
  const aiActions = actions.filter(action => actionKeyFamily(action.actionKey) === 'ai');
  const providerActions = actions.filter(action => actionKeyFamily(action.actionKey) === 'provider');
  const httpActions = actions.filter(action => actionKeyFamily(action.actionKey) === 'http_api');
  const actionsWithPrompt = actions.filter(action => action.hasPrompt || JSON.stringify(action.typeSettings || {}).match(/prompt|instructions|system/i));
  const actionsWithJsonSchema = actions.filter(action => action.hasJsonSchema || JSON.stringify(action.typeSettings || {}).match(/answerSchemaType|json|schema|properties/i));
  const actionsWithRunCondition = actions.filter(action => action.hasRunCondition || action.conditionalRunFormulaText || action.typeSettings?.conditionalRunFormulaText);
  const outputLikeFields = formulas.filter(field => {
    const ts = field.typeSettings || {};
    return Boolean(ts.mappedResultPath || ts.inputFieldIds || JSON.stringify(ts).match(/mappedResultPath|inputFieldIds/));
  });
  const tablesWithRows = countTablesWithRows(fixture);

  const checks = [
    { id: 'has_tables', passed: tables.length > 0, evidence: `${tables.length} table(s)` },
    { id: 'has_actions', passed: actions.length > 0, evidence: `${actions.length} action field(s)` },
    { id: 'has_ai_prompt_action', passed: actionsWithPrompt.some(action => actionKeyFamily(action.actionKey) === 'ai'), evidence: `${aiActions.length} AI action(s), ${actionsWithPrompt.length} prompted action(s)` },
    { id: 'has_json_schema_or_json_outputs', passed: actionsWithJsonSchema.length > 0, evidence: `${actionsWithJsonSchema.length} action(s) with JSON/schema signal` },
    { id: 'has_run_conditions', passed: actionsWithRunCondition.length > 0, evidence: `${actionsWithRunCondition.length} action(s) with run condition` },
    { id: 'has_provider_or_http_actions', passed: providerActions.length + httpActions.length > 0, evidence: `${providerActions.length} provider action(s), ${httpActions.length} HTTP action(s)` },
    { id: 'has_formula_or_output_fields', passed: formulas.length + outputLikeFields.length > 0, evidence: `${formulas.length} formula field(s), ${outputLikeFields.length} output-like field(s)` },
    { id: 'has_views', passed: views.length > 0, evidence: `${views.length} view(s)` },
  ];

  if (opts.requireRows) {
    checks.push({ id: 'has_populated_rows', passed: tablesWithRows > 0, evidence: `${tablesWithRows} table(s) with row counts in fixture` });
  }

  const failed = checks.filter(check => !check.passed);
  const primitiveSignals = actions.length === 0 || (actions.length > 0 && actionsWithPrompt.length === 0 && providerActions.length === 0 && httpActions.length === 0);
  const status = failed.length === 0
    ? 'workbook_parity_complete'
    : primitiveSignals
      ? 'primitive_proof'
      : 'partial_parity';

  return {
    artifactVersion: 1,
    kind: 'clay-workbook-parity-audit',
    status,
    workbookId: fixture.workbookId || null,
    workspaceId: fixture.workspaceId || null,
    summary: {
      tableCount: tables.length,
      actionCount: actions.length,
      formulaCount: formulas.length,
      viewCount: views.length,
      actionFamilies: families,
      promptedActionCount: actionsWithPrompt.length,
      jsonSchemaActionCount: actionsWithJsonSchema.length,
      runConditionActionCount: actionsWithRunCondition.length,
      providerActionCount: providerActions.length,
      httpActionCount: httpActions.length,
      tablesWithRows,
    },
    checks,
    missing: failed.map(check => check.id),
    recommendation: failed.length === 0 ? 'continue' : 'revise',
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || !flags.fixture) {
    console.log('Usage: node lib/workbook-parity.js --fixture fixture.json [--require-rows] [--out file] [--json]');
    return;
  }
  const audit = buildWorkbookParityAudit(readStructured(flags.fixture), { requireRows: Boolean(flags['require-rows']) });
  if (flags.out) {
    const full = path.isAbsolute(flags.out) ? flags.out : path.join(ROOT, flags.out);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(audit, null, 2) + '\n');
    console.log(JSON.stringify({ wrote: path.relative(ROOT, full), status: audit.status }, null, 2));
    return;
  }
  if (flags.json) process.stdout.write(JSON.stringify(audit, null, 2) + '\n');
  else process.stdout.write(YAML.stringify(audit));
}

if (require.main === module) main();

module.exports = {
  actionKeyFamily,
  buildWorkbookParityAudit,
};

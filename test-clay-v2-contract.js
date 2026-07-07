#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const clayV2Path = path.join(root, 'clay-v2.js');
const raw = fs.readFileSync(clayV2Path, 'utf8');

const help = execFileSync(process.execPath, [clayV2Path, 'help'], { encoding: 'utf8' });

for (const phrase of [
  'sources <tableId> [--out file]',
  'workbook-fixture <workbookId>',
  'workbook-export <workbookId>',
  'onboard-workspace',
  'integration-list',
  'create-webhook-source <tableId> --name NAME',
  '--allow-duplicate-webhook',
  '--allow-select-write',
]) {
  assert(help.includes(phrase) || raw.includes(phrase), `clay-v2 contract missing phrase: ${phrase}`);
}

for (const phrase of [
  "'create-webhook-source'",
  "type: 'webhook'",
  'table already has ${webhookSources.length} webhook source(s)',
  'select cell writes are not supported by the verified records API path yet',
  'Use --allow-select-write only for live probes',
  'withCommandProvenance',
  'workbookFixtureFromTables',
  'fullWorkbookExport',
  'onboardWorkspace',
  'actionInventoryFromWorkbookExport',
  'summarizeIntegrationGaps',
  'kind: \'clay-workbook-parity-fixture\'',
  'kind: \'clay-full-workbook-export\'',
  'use_ai_model_usecase_incompatible',
]) {
  assert(raw.includes(phrase), `clay-v2 implementation missing required guard/provenance phrase: ${phrase}`);
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
for (const phrase of [
  'Webhook Sources',
  'Real Workbook Parity Fixtures',
  'workbook-fixture',
  'onboard-workspace',
  'integration-library/registry.yaml',
  'create-webhook-source',
  'Duplicate webhook sources are refused',
  'Select cell writes are not supported yet',
  'View sort/filter updates are not supported yet',
  'api=...',
  'Primitive source/import proof is not the same as a real Clay workbook',
]) {
  assert(readme.includes(phrase), `README missing live caveat/support phrase: ${phrase}`);
}

console.log(JSON.stringify({ ok: true, checked: 'clay-v2-contract' }, null, 2));

#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  assignProofStrategy,
  assignCatalogProofStrategies,
} = require('./proof-strategy-classifier');

function action(overrides) {
  return {
    key: 'generic-find-company',
    displayName: 'Find company',
    categories: ['enrichment_tool'],
    package: { key: 'GenericPackage', categories: ['enrichment_tool'] },
    actionLabels: { type: 'Enrich Data' },
    ...overrides,
  };
}

const cases = [
  {
    name: 'external writes require sandbox and HITL',
    input: action({ key: 'apollo-oauth-create-contact', displayName: 'Create contact', auth: { providerType: 'apollo' } }),
    strategy: 'sandbox_external_write',
    rowLimit: 1,
    mode: 'sandbox',
    hitlRequired: true,
  },
  {
    name: 'internal writes require scratch sandbox and HITL',
    input: action({ key: 'add-row', displayName: 'Add row', package: { key: 'ClayPackage', categories: ['database'] }, auth: { providerType: 'clay' } }),
    strategy: 'sandbox_internal_write',
    rowLimit: 1,
    mode: 'sandbox',
    hitlRequired: true,
  },
  {
    name: 'credit enrichment is a one row live candidate with HITL',
    input: action({ key: 'bettercontact-find-work-email', pricing: { credits: { basic: 1 } } }),
    strategy: 'one_row_enrichment',
    rowLimit: 1,
    mode: 'live_candidate',
    hitlRequired: true,
  },
  {
    name: 'safe reads can be ten row live candidates',
    input: action({ key: 'lookup-company', displayName: 'Lookup company', categories: ['database'], package: { key: 'ClayPackage', categories: ['database'] }, actionLabels: { type: 'Lookup' } }),
    strategy: 'ten_row_safe_read',
    rowLimit: 10,
    mode: 'live_candidate',
    hitlRequired: false,
  },
  {
    name: 'source reads are capped preview candidates with HITL',
    input: action({ key: 'apollo-find-people-source', displayName: 'Find people source', auth: { providerType: 'apollo' } }),
    strategy: 'ten_row_source_preview',
    rowLimit: 10,
    mode: 'live_candidate',
    hitlRequired: true,
  },
  {
    name: 'auth validation remains offline by default',
    input: action({ key: 'apollo-validate-auth', displayName: 'Apollo Validate Auth', auth: { providerType: 'apollo' } }),
    strategy: 'offline_validate_auth',
    rowLimit: 0,
    mode: 'offline_only',
    hitlRequired: true,
  },
  {
    name: 'unknown safety blocks live proof',
    input: action({ key: '<redacted:abcdef123456>', displayName: 'Mystery', categories: [], package: null, actionLabels: {} }),
    strategy: 'review_block_unknown',
    rowLimit: 0,
    mode: 'offline_review_blocked',
    hitlRequired: true,
  },
];

for (const testCase of cases) {
  const assigned = assignProofStrategy(testCase.input);
  assert.strictEqual(assigned.proofStrategy.strategy, testCase.strategy, testCase.name);
  assert.strictEqual(assigned.proofStrategy.rowLimit, testCase.rowLimit, testCase.name);
  assert.strictEqual(assigned.proofStrategy.mode, testCase.mode, testCase.name);
  assert.strictEqual(assigned.proofStrategy.hitlRequired, testCase.hitlRequired, testCase.name);
}

const artifactPath = path.join(__dirname, 'runs/2026-06-09/full-integration-audit-shards/actions-catalog.raw.json');
if (fs.existsSync(artifactPath)) {
  const catalog = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const assigned = assignCatalogProofStrategies(catalog);
  assert.strictEqual(assigned.summary.totalActions, catalog.count);
  assert.strictEqual(Object.keys(assigned.strategies).length, assigned.summary.uniqueKeys);
  assert.strictEqual(assigned.strategies['bettercontact-find-work-email'].proofStrategy.strategy, 'one_row_enrichment');
  assert.strictEqual(assigned.strategies['apollo-oauth-create-contact'].proofStrategy.strategy, 'sandbox_external_write');
  assert.strictEqual(assigned.strategies['apollo-find-people-source'].proofStrategy.strategy, 'ten_row_source_preview');
  assert(assigned.summary.strategyCounts.review_block_unknown >= 1, 'expected redacted/unknown keys to review-block');
  for (const [key, entry] of Object.entries(assigned.strategies)) {
    assert(entry.proofStrategy, `${key} missing proof strategy`);
    assert(Number.isInteger(entry.proofStrategy.rowLimit), `${key} missing row limit`);
    assert(entry.proofStrategy.mode, `${key} missing mode`);
    assert.strictEqual(typeof entry.proofStrategy.hitlRequired, 'boolean', `${key} missing HITL requirement`);
    if (entry.safetyClass === 'unknown') assert.strictEqual(entry.proofStrategy.strategy, 'review_block_unknown', `${key} unknown must block`);
    if (entry.safetyClass === 'external_write') assert.strictEqual(entry.proofStrategy.strategy, 'sandbox_external_write', `${key} external write must sandbox`);
  }
}

console.log(JSON.stringify({ ok: true, cases: cases.length, artifactChecked: fs.existsSync(artifactPath) }, null, 2));

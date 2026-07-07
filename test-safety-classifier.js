#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { classifyAction, classifyCatalog } = require('./safety-classifier');

function action(overrides) {
  return {
    key: 'fixture-unknown',
    version: 1,
    displayName: 'Fixture Unknown',
    description: 'No matching semantics',
    package: { key: 'FixturePackage', displayName: 'Fixture' },
    categories: [],
    isPublic: true,
    actionLabels: {},
    ...overrides,
  };
}

const fixtures = [
  [
    'auth validator',
    action({ key: 'bettercontact-validate-auth', displayName: 'BetterContact Validate Auth', description: 'Validate the BetterContact API key', categories: ['enrichment_tool'] }),
    'auth',
  ],
  [
    'destructive CRM removal',
    action({ key: 'pardot-delete-list-membership', displayName: 'Remove Pardot prospect from list', description: 'Remove a prospect from a Pardot list by membership ID', categories: ['crm'], actionLabels: { type: 'Send Data' } }),
    'destructive',
  ],
  [
    'bulk query job',
    action({ key: 'salesforce-records-bulk-query-object-type-create-job', displayName: 'Create Salesforce Bulk Query API v2 job for object type', description: 'Creates a Bulk Query API v2 job', categories: ['crm'] }),
    'bulk',
  ],
  [
    'source import',
    action({ key: 'google-bigquery-import-source', displayName: 'Import Data from BigQuery', description: 'Import data using SQL', actionLabels: { type: 'Add Data' } }),
    'source',
  ],
  [
    'mutation export/send',
    action({ key: 'ads-audience-export-contact', displayName: 'Export contacts to ads audience', description: 'Send contact data to an audience', actionLabels: { type: 'Send Data' } }),
    'mutation',
  ],
  [
    'purchase/credit consuming enrichment',
    action({ key: 'enigma-get-12-month-avg-transaction-size', displayName: 'Get average transaction size', description: 'Uses transaction data', pricing: { postPricingChange2026: { credits: { actionExecution: 1 } } } }),
    'purchase',
  ],
  [
    'internal deprecated candidate',
    action({ key: 'legacy-fixture', displayName: 'Legacy fixture (deprecated)', description: 'Deprecated action', isPublic: false }),
    'internal_deprecated',
  ],
  [
    'read enrichment',
    action({ key: 'hithorizons-company-firmographics', displayName: 'Find EMEA Company Firmographics', description: 'Find sales, employee count, industry code, and location', categories: ['enrichment_tool'], actionLabels: { type: 'Enrich Data' } }),
    'read_enrichment',
  ],
  [
    'unknown default',
    action({ key: 'opaque-fixture', displayName: 'Opaque Fixture', description: 'Does something unspecified' }),
    'unknown_requires_review',
  ],
];

for (const [name, fixture, expected] of fixtures) {
  const classified = classifyAction(fixture);
  assert.strictEqual(classified.primarySafetyClass, expected, name);
  assert(Array.isArray(classified.evidence) && classified.evidence.length > 0, `${name}: missing evidence`);
}

const duplicateCatalog = classifyCatalog({ actions: [
  action({ key: 'duplicate-key', displayName: 'Find record', description: 'Find one record' }),
  action({ key: 'duplicate-key', displayName: 'Delete record', description: 'Delete one record' }),
  action({ key: 'unique-key', displayName: 'Opaque', description: 'No match' }),
] });

assert.strictEqual(duplicateCatalog.classificationMode, 'per_catalog_key');
assert.strictEqual(duplicateCatalog.totalInputActions, 3);
assert.strictEqual(duplicateCatalog.totalClassifications, 2);
assert.strictEqual(duplicateCatalog.classifications.find(item => item.key === 'duplicate-key').primarySafetyClass, 'destructive');
assert.strictEqual(duplicateCatalog.classifications.find(item => item.key === 'unique-key').primarySafetyClass, 'unknown_requires_review');
assert.strictEqual(duplicateCatalog.classifications.every(item => typeof item.primarySafetyClass === 'string'), true);

console.log('safety-classifier tests passed');

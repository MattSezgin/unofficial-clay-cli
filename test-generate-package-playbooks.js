'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generate, strategyClass, isReviewPackage } = require('./generate-package-playbooks');

function writeFixture(file) {
  const fixture = {
    count: 5,
    actions: [
      {
        key: 'cpj-find-company',
        version: 1,
        package: { id: 'pkg-cpj', key: 'CompaniesPeopleJobsPackage', displayName: 'Companies, People, Jobs', categories: ['source'] },
        displayName: 'Find Company',
        description: 'Search companies by domain.',
        inputParameterSchema: [{ name: 'domain', displayName: 'Company domain', optional: false }],
        outputParameterSchema: [],
        auth: { providerType: 'clay' },
        isPublic: true,
      },
      {
        key: 'hubspot-create-contact',
        version: 1,
        package: { id: 'pkg-hubspot', key: 'HubspotNewUiPackage', displayName: 'HubSpot', categories: ['crm'] },
        displayName: 'Create Contact',
        description: 'Create a contact in HubSpot.',
        inputParameterSchema: [{ name: 'email', displayName: 'Email', optional: false }],
        outputParameterSchema: [],
        auth: { providerType: 'hubspot' },
        isPublic: false,
      },
      {
        key: 'hubspot-validate-auth',
        version: 1,
        package: { id: 'pkg-hubspot', key: 'HubspotNewUiPackage', displayName: 'HubSpot', categories: ['crm'] },
        displayName: 'Validate Auth',
        description: 'Validate auth.',
        inputParameterSchema: [],
        outputParameterSchema: [],
        auth: { providerType: 'hubspot' },
        isPublic: false,
      },
      {
        key: 'salesforce-test-create',
        version: 1,
        package: { id: 'pkg-sf-test', key: 'SalesforceTestEnvPackage', displayName: 'Salesforce Test Environment', categories: ['crm'] },
        displayName: 'Create test record',
        description: 'Internal test package.',
        inputParameterSchema: [],
        outputParameterSchema: [],
        auth: { providerType: 'salesforce' },
        isPublic: false,
      },
      {
        key: 'snowflake-query',
        version: 1,
        package: { id: 'pkg-snowflake', key: 'SnowflakePackage', displayName: 'Snowflake', categories: ['warehouse'] },
        displayName: 'Run Query',
        description: 'Run SQL query.',
        inputParameterSchema: [{ name: 'sql', displayName: 'SQL', optional: false }],
        outputParameterSchema: [],
        auth: { providerType: 'snowflake' },
        isPublic: true,
      },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2));
}

function main() {
  assert.strictEqual(strategyClass({ key: 'x', displayName: 'Validate Auth', description: '' }), 'auth-validation');
  assert.strictEqual(strategyClass({ key: 'x', displayName: 'Create Contact', description: '' }), 'external-write-or-sync');
  assert.strictEqual(strategyClass({ key: 'x', displayName: 'Run Query', description: 'SQL warehouse' }), 'warehouse-query');
  assert.strictEqual(isReviewPackage('Salesforce Test Environment', 'SalesforceTestEnvPackage'), true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-package-playbooks-'));
  const catalog = path.join(dir, 'catalog.json');
  const out = path.join(dir, 'out');
  writeFixture(catalog);

  const first = generate(catalog, out);
  const firstFiles = Object.fromEntries(fs.readdirSync(out).sort().map((file) => [file, fs.readFileSync(path.join(out, file), 'utf8')]));
  const second = generate(catalog, out);
  const secondFiles = Object.fromEntries(fs.readdirSync(out).sort().map((file) => [file, fs.readFileSync(path.join(out, file), 'utf8')]));

  assert.deepStrictEqual(first, second);
  assert.deepStrictEqual(firstFiles, secondFiles);
  assert.ok(firstFiles['README.md'].includes('[CPJ](cpj.md)'));
  assert.ok(firstFiles['README.md'].includes('[HubSpot](hubspot.md)'));
  assert.ok(firstFiles['README.md'].includes('Salesforce Test Environment'));
  assert.ok(firstFiles['hubspot.md'].includes('## Safe proof order'));
  assert.ok(firstFiles['hubspot.md'].includes('external-write-or-sync'));
  assert.ok(firstFiles['hubspot.md'].includes('Need an isolated sandbox destination'));
  assert.ok(!firstFiles['README.md'].includes('[Salesforce](salesforce.md)'));

  console.log('test-generate-package-playbooks: ok');
}

main();

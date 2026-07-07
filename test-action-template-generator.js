#!/usr/bin/env node

const assert = require('assert');
const { generateTemplate, generateTemplates } = require('./action-template-generator');

const knownInputAction = {
  key: 'bettercontact-find-work-email',
  version: 1,
  package: { id: 'pkg_bettercontact', displayName: 'BetterContact' },
  displayName: 'Find work email',
  actionLabels: { type: 'Enrich Data' },
  inputParameterSchema: [
    { name: 'name', optional: false, displayName: "Person's name", typeSettings: { type: 'column-select', semanticType: 'full-name' } },
    { name: 'domain', optional: true, displayName: 'Company domain', typeSettings: { type: 'column-select', semanticType: 'company-domain' } },
  ],
  outputParameterSchema: [{ name: 'email', type: 'text', displayName: 'Email' }],
};

const unknownInputAction = {
  key: 'legacy-unknown',
  version: 1,
  package: { id: 'pkg_legacy' },
  displayName: 'Legacy Unknown',
};

const authRequiredAction = {
  key: 'http-api-v2',
  version: 1,
  package: { id: 'pkg_http' },
  displayName: 'HTTP API',
  actionLabels: { requiresApiKey: '<redacted:fcbcf165908d>' },
  auth: { providerType: 'http-api' },
  inputParameterSchema: [
    { name: 'url', optional: false, type: 'text' },
    { name: 'apiKey', optional: true, type: 'text' },
  ],
};

const sourceAction = {
  key: 'find-companies',
  version: 1,
  package: { id: 'pkg_find' },
  displayName: 'Find companies with Find AI (beta)',
  actionLabels: { type: 'Add Data' },
  inputParameterSchema: [
    { name: 'query', type: 'longtext', displayName: 'Query' },
    { name: 'maxResults', optional: true, typeSettings: { type: 'number' }, displayName: 'Limit' },
  ],
};

const known = generateTemplate(knownInputAction);
assert.deepStrictEqual(known.inputSurface.required.map(i => i.name), ['name']);
assert.deepStrictEqual(known.inputSurface.optional.map(i => i.name), ['domain']);
assert.deepStrictEqual(known.inputSurface.unknown, []);
assert.strictEqual(known.specFragment.fields[0].inputs.name, '${CLAY_INPUT_NAME:-}');
assert.strictEqual(known.specFragment.fields[0].inputs.domain, '${CLAY_INPUT_DOMAIN:-}');
assert.ok(known.safety.warnings.some(w => /not strict battle-tested proof/i.test(w)));
assert.strictEqual(known.validation.valid, true);

const unknown = generateTemplate(unknownInputAction);
assert.strictEqual(unknown.inputSurface.unknown.length, 1);
assert.deepStrictEqual(unknown.specFragment.fields[0].inputs, {});
assert.ok(unknown.validation.issues.some(i => i.type === 'unknown_inputs_present'));
assert.strictEqual(unknown.validation.valid, true);

const auth = generateTemplate(authRequiredAction);
assert.strictEqual(auth.auth.required, true);
assert.strictEqual(auth.auth.providerType, 'http-api');
assert.deepStrictEqual(auth.inputSurface.authDependent.map(i => i.name), ['apiKey']);
assert.strictEqual(auth.specFragment.fields[0].authAccountId, '${CLAY_AUTH_ACCOUNT_ID:-}');
assert.ok(!JSON.stringify(auth).includes('secret-token-value'));
assert.strictEqual(auth.validation.valid, true);

const source = generateTemplate(sourceAction);
assert.deepStrictEqual(source.action.types, ['Add Data']);
assert.deepStrictEqual(source.inputSurface.required.map(i => i.name), ['query']);
assert.deepStrictEqual(source.inputSurface.optional.map(i => i.name), ['maxResults']);
assert.strictEqual(source.specFragment.fields[0].inputs.query, '${CLAY_INPUT_QUERY:-}');
assert.strictEqual(source.validation.valid, true);

const generated = generateTemplates({ actions: [knownInputAction, sourceAction] }, { query: 'find companies' });
assert.strictEqual(generated.length, 1);
assert.strictEqual(generated[0].action.key, 'find-companies');

console.log('action-template-generator tests passed');

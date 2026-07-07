#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  loadIntegrationRegistry,
  listIntegrations,
  getIntegration,
  PROOF_STATUSES,
  STRICT_PROOF_REQUIREMENT_KEYS,
  validateActionFieldAgainstRegistry,
  validateSpecAgainstIntegrationRegistry,
  validateRegistryProofStates,
  integrationPromotionReport,
  integrationPromotionMarkdown,
} = require('../lib/integration-library');

const registry = loadIntegrationRegistry();
assert(registry.integrations['use-ai']);
assert(PROOF_STATUSES.has('real_data_output_verified'));
assert(PROOF_STATUSES.has('blocked_destructive_external_mutation'));
assert(STRICT_PROOF_REQUIREMENT_KEYS.includes('parentFullValueInspected'));
assert(listIntegrations(registry).length >= 10);
const proofStateValidation = validateRegistryProofStates(registry);
assert.strictEqual(proofStateValidation.valid, true, JSON.stringify(proofStateValidation.issues.slice(0, 5), null, 2));
assert.strictEqual(getIntegration('leadmagic-find-work-email', registry).actionKey, 'leadmagic-find-work-email');
assert(getIntegration('leadmagic-find-work-email', registry).requiredInputs.includes('name'));
assert(getIntegration('leadmagic-find-work-email', registry).optionalInputsObserved.includes('includeCatchAll'));
assert(getIntegration('use-ai', registry).candidateRequiredInputsObserved.includes('temperature'));

const goodLeadMagic = {
  name: 'Find work email',
  type: 'action',
  actionKey: 'leadmagic-find-work-email',
  actionPackageId: 'edb58209-a62d-42be-992a-e41b87eeacc2',
  actionVersion: 1,
  authEnv: 'CLAY_LEADMAGIC_AUTH_ACCOUNT_ID',
  runCondition: '!!{{Full Name}} && !!{{Domain}}',
  inputs: { name: '{{Full Name}}', domain: '{{Domain}}', includeCatchAll: 'false' },
};
assert.deepStrictEqual(validateActionFieldAgainstRegistry(goodLeadMagic, registry), []);

const discoveredIntegration = {
  name: 'Discovered-only integration fixture',
  type: 'action',
  actionKey: 'apollo-oauth-enrich-person',
  actionPackageId: '778df10d-f68b-461a-8eb7-56047737f5eb',
  actionVersion: 1,
  strictIntegrationCoverage: true,
  authEnv: 'CLAY_APOLLO_AUTH_ACCOUNT_ID',
  inputs: { domain: '{{Domain}}', first_name: '{{First Name}}', last_name: '{{Last Name}}' },
};
assert(validateActionFieldAgainstRegistry(discoveredIntegration, registry).some(issue => issue.type === 'integration_not_strictly_battle_tested'));

const reviewedButNotProven = {
  name: 'Reviewed but not strictly proven fixture',
  type: 'action',
  actionKey: 'leadmagic-find-work-email',
  actionPackageId: 'edb58209-a62d-42be-992a-e41b87eeacc2',
  actionVersion: 1,
  strictIntegrationCoverage: true,
  authEnv: 'CLAY_LEADMAGIC_AUTH_ACCOUNT_ID',
  runCondition: '!!{{Full Name}} && !!{{Domain}}',
  inputs: { name: '{{Full Name}}', domain: '{{Domain}}' },
};
assert(validateActionFieldAgainstRegistry(reviewedButNotProven, registry).some(issue => issue.type === 'integration_not_strictly_battle_tested' && issue.promotionStatus === 'reviewed'));

const badPackage = { ...goodLeadMagic, actionPackageId: 'wrong-package' };
assert(validateActionFieldAgainstRegistry(badPackage, registry).some(issue => issue.type === 'unexpected_action_package_id'));

const specValidation = validateSpecAgainstIntegrationRegistry({ fields: [goodLeadMagic] }, registry);
assert.strictEqual(specValidation.valid, true);

const cli = path.join(__dirname, '..', 'clay-v2.js');
const list = JSON.parse(execFileSync(process.execPath, [cli, 'integration-list'], { encoding: 'utf8' }));
assert(list.count >= 10);
const show = JSON.parse(execFileSync(process.execPath, [cli, 'integration-show', 'use-ai'], { encoding: 'utf8' }));
assert.strictEqual(show.actionKey, 'use-ai');
assert(show.requiredInputs.includes('prompt'));
assert(show.optionalInputsObserved.includes('temperature'));
assert(['discovered', 'reviewed', 'battle-tested'].includes(show.promotionStatus));
assert(list.integrations.every(item => ['discovered', 'reviewed', 'battle-tested'].includes(item.promotionStatus)));

const report = integrationPromotionReport(registry);
assert.strictEqual(report.strictBattleTestedCount, report.battleTested.length);
assert.strictEqual(report.blockedCount, report.blocked.length);
assert.strictEqual(report.battleTested.length, 25);
assert.deepStrictEqual(report.battleTested, ['datagma-find-work-email-v3', 'dropcontact-enrich-person', 'enrich-company-with-mixrank-v2', 'enrich-person-with-mixrank-v2', 'extract-email-components', 'find-email-v2', 'find-lists-of-companies-with-mixrank-source', 'find-lists-of-people-with-mixrank-source', 'findymail-find-work-email', 'generate-email-permutations', 'google-company-to-domain', 'hg-insights-find-domain-from-company-name', 'http-api-v2', 'icypeas-find-email-v2', 'leadmagic-validate-email', 'lookup-company-in-other-table', 'lookup-multiple-rows-in-other-table', 'lookup-row-in-other-table', 'normalize-company-name', 'scrape-website', 'snov-domain-by-company-name', 'use-ai', 'validate-email', 'wiza-find-email', 'wiza-find-work-email']);
assert(!report.needsProof.some(item => item.actionKey === 'use-ai'));
assert(!report.needsProof.some(item => item.actionKey === 'normalize-company-name'));
assert(report.needsProof.some(item => item.actionKey === 'leadmagic-find-work-email' && item.promotionStatus === 'reviewed'));
assert(report.needsProof.every(item => Array.isArray(item.missingProofRequirements) && item.missingProofRequirements.length > 0));
assert.strictEqual(typeof report.ambiguousCount, 'number');
const blockedActionKeys = new Set(report.blocked.map(item => item.actionKey));
assert.strictEqual(report.ambiguousCount, report.needsProof.filter(item => !blockedActionKeys.has(item.actionKey)).length);
assert.strictEqual(report.blockedCount, 15);
assert.deepStrictEqual(report.blocked.map(item => item.actionKey), ['add-lead-to-campaign', 'apify-run-actor', 'apollo-oauth-enrich-person', 'check-url', 'enrich-job', 'find-lists-of-jobs-with-mixrank-source', 'get-domain-from-company-name', 'icypeas-enrich-profile', 'instantly-v2-add-lead-to-campaign', 'leadmagic-enrich-company', 'leadmagic-find-work-email', 'lookup-lead-in-campaign', 'prospeo-find-work-email-v2', 'smartlead-lookup-lead-status', 'trigger-find-people-source']);
assert.deepStrictEqual(report.proofStatusCounts.real_data_output_verified, 25);
assert.strictEqual(report.proofStatusCounts.blocked_requires_auth, 1);
assert.strictEqual(report.proofStatusCounts.blocked_external_dependency, 3);
assert.strictEqual(report.proofStatusCounts.blocked_missing_safe_test_data, 8);
assert.strictEqual(report.proofStatusCounts.blocked_paid_or_unbounded_cost, 1);
assert.strictEqual(report.proofStatusCounts.blocked_destructive_external_mutation, 2);
const markdown = integrationPromotionMarkdown(report);
assert(markdown.includes('# Clay Integration Promotion Report'));
assert(markdown.includes('## Next proof targets'));
assert(markdown.includes('`leadmagic-find-work-email`'));
const cliMarkdown = execFileSync(process.execPath, [cli, 'integration-promotion-report', '--format', 'markdown'], { encoding: 'utf8' });
assert(cliMarkdown.includes('# Clay Integration Promotion Report'));
assert(cliMarkdown.includes('Strict battle-tested: 25'));
assert(cliMarkdown.includes('Blocked: 15'));

const docsDir = path.join(__dirname, '..', 'docs', 'integrations');
for (const file of fs.readdirSync(docsDir).filter(file => file.endsWith('.md') && file !== 'README.md')) {
  const slug = file.replace(/\.md$/, '') === 'use-ai-claygent' ? 'use-ai' : file.replace(/\.md$/, '');
  const text = fs.readFileSync(path.join(docsDir, file), 'utf8');
  if (text.includes('Promotion status: `battle-tested`')) {
    assert(report.battleTested.includes(slug), `${file} claims battle-tested but strict proof report does not agree`);
  }
}

console.log(JSON.stringify({ ok: true, checked: 'integration-library', integrations: list.count, strictBattleTested: report.battleTested.length }, null, 2));

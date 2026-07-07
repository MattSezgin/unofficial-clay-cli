'use strict';

const assert = require('assert');
const { buildBlockedActionReport, renderMarkdown } = require('./blocked-action-report');

const catalog = {
  actions: [
    {
      key: 'hubspot-create-contact',
      displayName: 'Create Contact',
      package: { key: 'HubSpotPackage', displayName: 'HubSpot' },
      isPublic: true,
      auth: { providerType: 'hubspot' },
      actionEnablementInfo: { enabledStatusReason: 'ENABLED' },
      inputParameterSchema: [{ name: 'email', displayName: 'Email', optional: false }]
    },
    {
      key: 'find-company-domain',
      displayName: 'Find Company Domain',
      package: { key: 'ClayPackage', displayName: 'Clay' },
      isPublic: true,
      actionEnablementInfo: { enabledStatusReason: 'ENABLED' },
      inputParameterSchema: [{ name: 'companyName', displayName: 'Company Name', optional: false }]
    },
    {
      key: 'apollo-find-mobile-phone',
      displayName: 'Find Mobile Phone',
      package: { key: 'ApolloPackage', displayName: 'Apollo.io' },
      isPublic: true,
      auth: { providerType: 'apollo' },
      actionEnablementInfo: { enabledStatusReason: 'BILLING_PLAN_GATE' },
      inputParameterSchema: [{ name: 'linkedinUrl', displayName: 'LinkedIn URL', optional: false }]
    },
    {
      key: 'legacy-enrich-person',
      displayName: 'Enrich Person (deprecated)',
      package: { key: 'LegacyPackage', displayName: 'Legacy' },
      isPublic: false,
      actionEnablementInfo: { enabledStatusReason: 'ENABLED' },
      inputParameterSchema: [{ name: 'profileUrl', displayName: 'Profile URL', optional: false }]
    },
    {
      key: 'stripe-read-invoice',
      displayName: 'Read Invoice',
      package: { key: 'StripePackage', displayName: 'Stripe' },
      isPublic: true,
      actionEnablementInfo: { enabledStatusReason: 'ENABLED' },
      inputParameterSchema: [{ name: 'invoiceId', displayName: 'Invoice ID', optional: false, dynamicOptions: true }]
    },
    {
      key: 'reddit-top-posts',
      displayName: 'Get top reddit posts',
      package: { key: 'RedditPackage', displayName: 'Reddit' },
      isPublic: true,
      actionEnablementInfo: { enabledStatusReason: 'ENABLED' },
      inputParameterSchema: [{ name: 'subredditName', displayName: 'Subreddit Name', optional: false }]
    }
  ]
};

const report = buildBlockedActionReport(catalog);

assert.strictEqual(report.totals.actions, 6);
assert.strictEqual(report.byReason.missing_auth.length, 2);
assert.strictEqual(report.byReason.missing_safe_data.length, 4);
assert.strictEqual(report.byReason.destructive_mutation.length, 1);
assert.strictEqual(report.byReason.paid_unbounded.length, 2);
assert.strictEqual(report.byReason.external_sandbox_required.length, 3);
assert.strictEqual(report.byReason.internal_deprecated_candidate.length, 1);
assert.strictEqual(report.byReason.unknown_review.length, 1);

const hubspot = report.entries.find(entry => entry.key === 'hubspot-create-contact');
assert(hubspot.blockers.some(blocker => blocker.reason === 'destructive_mutation'));
assert(hubspot.unblockInstructions.includes('The operator must explicitly approve the exact mutation, target sandbox, row scope, and rollback/cleanup plan before any live proof run.'));
assert.strictEqual(hubspot.hitlRequirement, 'operator_required');

const clay = report.entries.find(entry => entry.key === 'find-company-domain');
assert.deepStrictEqual(clay.blockers.map(blocker => blocker.reason), ['missing_safe_data']);
assert.strictEqual(clay.hitlRequirement, 'afk_resolvable');
assert.strictEqual(clay.unblockInstructions[0], 'Create or select a redacted synthetic fixture row with the required input fields populated; do not use client PII or production records.');

assert(report.byPackage['Apollo.io'].some(entry => entry.key === 'apollo-find-mobile-phone'));
assert(report.byHitlRequirement.operator_required.some(entry => entry.key === 'hubspot-create-contact'));
assert(report.byHitlRequirement.afk_resolvable.some(entry => entry.key === 'find-company-domain'));

const markdown = renderMarkdown(report);
assert(markdown.includes('Catalog coverage only: this report is derived from the raw action catalog and is not strict battle-tested proof of any Clay action.'));
assert(markdown.includes('### Missing auth (2)'));
assert(markdown.includes('Exact unblock instruction: The operator must provide or approve a non-production auth account for this provider, then rerun proof only against the approved account.'));
assert(markdown.includes('### afk_resolvable (1)'));

console.log('blocked-action-report tests passed');

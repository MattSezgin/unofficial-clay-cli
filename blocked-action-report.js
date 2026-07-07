#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const BLOCKER_DEFINITIONS = {
  missing_auth: {
    label: 'Missing auth',
    hitl: 'operator_required',
    unblockInstruction: 'The operator must provide or approve a non-production auth account for this provider, then rerun proof only against the approved account.'
  },
  missing_safe_data: {
    label: 'Missing safe data',
    hitl: 'afk_resolvable',
    unblockInstruction: 'Create or select a redacted synthetic fixture row with the required input fields populated; do not use client PII or production records.'
  },
  destructive_mutation: {
    label: 'Destructive mutation',
    hitl: 'operator_required',
    unblockInstruction: 'The operator must explicitly approve the exact mutation, target sandbox, row scope, and rollback/cleanup plan before any live proof run.'
  },
  paid_unbounded: {
    label: 'Paid/unbounded',
    hitl: 'operator_required',
    unblockInstruction: 'The operator must approve expected credit/spend limits and a hard row cap; record the cap in the proof plan before running.'
  },
  external_sandbox_required: {
    label: 'External sandbox required',
    hitl: 'operator_required',
    unblockInstruction: 'The operator must provide or approve a disposable external sandbox/workspace and confirm that writes and callbacks are isolated from production.'
  },
  unknown_review: {
    label: 'Unknown review',
    hitl: 'operator_required',
    unblockInstruction: 'Review the action schema and captured UI/API behavior, assign a concrete blocker category, and only then move it into a proof plan.'
  },
  internal_deprecated_candidate: {
    label: 'Internal/deprecated candidate',
    hitl: 'operator_required',
    unblockInstruction: 'Confirm with the operator whether this internal, private, beta, or deprecated action is in scope; otherwise exclude it from strict proof.'
  }
};

const MUTATION_RE = /\b(add|archive|assign|book|cancel|clear|clone|connect|create|delete|disable|disconnect|enable|enroll|export|import|insert|invite|launch|merge|move|publish|push|refresh|remove|run|schedule|send|sync|transfer|trigger|update|upload|write)\b/i;
const SAFE_READ_RE = /\b(check|enrich|find|get|lookup|preview|read|search|validate|verify)\b/i;
const INTERNAL_RE = /\b(beta|deprecated|internal|legacy|private|test)\b/i;
const EXTERNAL_SANDBOX_RE = /\b(apollo|attio|bigquery|campaign|crm|email|gmail|google ads|hubspot|lemlist|mailchimp|outreach|pipedrive|salesforce|sendgrid|slack|snowflake|stripe|webhook|zapier)\b/i;
const PAID_RE = /\b(credit|paid|premium|waterfall|bulk|mobile phone|phone|email|enrich|provider)\b/i;
const SAFE_DATA_RE = /\b(company|domain|email|first name|last name|linkedin|person|phone|profile|url|website)\b/i;

function textOf(action) {
  return [
    action.key,
    action.displayName,
    action.description,
    action.package?.key,
    action.package?.displayName,
    ...(action.categories || []),
    ...(action.package?.categories || [])
  ].filter(Boolean).join(' ');
}

function requiredInputs(action) {
  return (action.inputParameterSchema || []).filter(input => !input.optional);
}

function hasDynamicInputs(action) {
  return (action.inputParameterSchema || []).some(input => input.dynamicOptions || input.refreshDynamicFieldsOnValueChange);
}

function classifyBlockedAction(action) {
  const text = textOf(action);
  const inputs = requiredInputs(action);
  const blockers = [];

  if (action.isPublic === false || INTERNAL_RE.test(text)) blockers.push('internal_deprecated_candidate');
  if (MUTATION_RE.test(text) && !/^validate\b/i.test(action.displayName || '')) blockers.push('destructive_mutation');
  if (action.actionEnablementInfo?.enabledStatusReason === 'BILLING_PLAN_GATE' || action.actionEnablementInfo?.billingPlanGate || PAID_RE.test(text)) blockers.push('paid_unbounded');
  if (EXTERNAL_SANDBOX_RE.test(text) || hasDynamicInputs(action)) blockers.push('external_sandbox_required');
  if (action.auth && Object.keys(action.auth).length) blockers.push('missing_auth');
  if (inputs.some(input => SAFE_DATA_RE.test([input.name, input.displayName, input.description, input.typeSettings?.semanticType].filter(Boolean).join(' ')))) blockers.push('missing_safe_data');
  if (!blockers.length) blockers.push('unknown_review');

  return [...new Set(blockers)].map(reason => ({ reason, ...BLOCKER_DEFINITIONS[reason] }));
}

function entryFor(action) {
  const blockers = classifyBlockedAction(action);
  return {
    key: redact(action.key || ''),
    displayName: redact(action.displayName || ''),
    packageKey: redact(action.package?.key || ''),
    packageName: redact(action.package?.displayName || ''),
    isPublic: action.isPublic ?? null,
    enabledStatusReason: action.actionEnablementInfo?.enabledStatusReason || null,
    requiredInputs: requiredInputs(action).map(input => redact(input.displayName || input.name || '')),
    blockers,
    hitlRequirement: blockers.some(blocker => blocker.hitl === 'operator_required') ? 'operator_required' : 'afk_resolvable',
    unblockInstructions: blockers.map(blocker => blocker.unblockInstruction)
  };
}

function buildBlockedActionReport(catalog) {
  const actions = Array.isArray(catalog) ? catalog : (catalog.actions || []);
  const entries = actions.map(entryFor).sort((a, b) => (a.packageName || a.packageKey).localeCompare(b.packageName || b.packageKey) || a.displayName.localeCompare(b.displayName) || a.key.localeCompare(b.key));
  const byReason = Object.fromEntries(Object.keys(BLOCKER_DEFINITIONS).map(reason => [reason, []]));
  const byPackage = {};
  const byHitlRequirement = { operator_required: [], afk_resolvable: [] };

  for (const entry of entries) {
    for (const blocker of entry.blockers) byReason[blocker.reason].push(entry);
    const pkg = entry.packageName || entry.packageKey || '<unknown package>';
    byPackage[pkg] ||= [];
    byPackage[pkg].push(entry);
    byHitlRequirement[entry.hitlRequirement].push(entry);
  }

  return {
    generatedAt: new Date(0).toISOString(),
    catalogCoverageNotice: 'Catalog coverage only: this report is derived from the raw action catalog and is not strict battle-tested proof of any Clay action.',
    strictProofNotice: 'Blocked entries must not be treated as live proof until their unblock instructions are satisfied and fresh readback evidence exists.',
    totals: {
      actions: entries.length,
      reasonMemberships: Object.fromEntries(Object.entries(byReason).map(([reason, list]) => [reason, list.length])),
      packages: Object.keys(byPackage).length,
      operatorRequiredHitl: byHitlRequirement.operator_required.length,
      afkResolvable: byHitlRequirement.afk_resolvable.length
    },
    blockerDefinitions: BLOCKER_DEFINITIONS,
    entries,
    byReason,
    byPackage,
    byHitlRequirement
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Clay blocked-action report', '');
  lines.push(`> ${report.catalogCoverageNotice}`);
  lines.push(`> ${report.strictProofNotice}`, '');
  lines.push('## Totals', '');
  lines.push(`- Actions: ${report.totals.actions}`);
  lines.push(`- Packages: ${report.totals.packages}`);
  lines.push(`- Operator-required HITL: ${report.totals.operatorRequiredHitl}`);
  lines.push(`- AFK-resolvable only: ${report.totals.afkResolvable}`, '');
  lines.push('## By unblock reason', '');
  for (const [reason, definition] of Object.entries(report.blockerDefinitions)) {
    const entries = report.byReason[reason] || [];
    lines.push(`### ${definition.label} (${entries.length})`, '');
    lines.push(`- HITL: ${definition.hitl}`);
    lines.push(`- Exact unblock instruction: ${definition.unblockInstruction}`);
    for (const entry of entries) lines.push(`  - ${entry.packageName || entry.packageKey || '<unknown package>'} / ${entry.displayName} (${entry.key}) — ${entry.hitlRequirement}`);
    lines.push('');
  }
  lines.push('## By package', '');
  for (const [pkg, entries] of Object.entries(report.byPackage).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`### ${pkg} (${entries.length})`);
    for (const entry of entries) lines.push(`- ${entry.displayName} (${entry.key}) — ${entry.blockers.map(b => b.reason).join(', ')} — ${entry.hitlRequirement}`);
    lines.push('');
  }
  lines.push('## By HITL requirement', '');
  for (const hitl of ['operator_required', 'afk_resolvable']) {
    const entries = report.byHitlRequirement[hitl] || [];
    lines.push(`### ${hitl} (${entries.length})`);
    for (const entry of entries) lines.push(`- ${entry.packageName || entry.packageKey || '<unknown package>'} / ${entry.displayName} (${entry.key})`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

function redact(value) {
  return String(value).replace(/[A-Za-z0-9_]{32,}/g, '<redacted:id>');
}

function loadCatalog(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--catalog') args.catalog = argv[++i];
    else if (arg === '--json-out') args.jsonOut = argv[++i];
    else if (arg === '--md-out') args.mdOut = argv[++i];
    else args._.push(arg);
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.catalog) throw new Error('usage: node blocked-action-report.js --catalog actions.raw.json [--json-out report.json] [--md-out report.md]');
  const report = buildBlockedActionReport(loadCatalog(args.catalog));
  if (args.jsonOut) {
    fs.mkdirSync(path.dirname(args.jsonOut), { recursive: true });
    fs.writeFileSync(args.jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.mdOut) {
    fs.mkdirSync(path.dirname(args.mdOut), { recursive: true });
    fs.writeFileSync(args.mdOut, renderMarkdown(report));
  }
  if (!args.jsonOut && !args.mdOut) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  BLOCKER_DEFINITIONS,
  classifyBlockedAction,
  buildBlockedActionReport,
  renderMarkdown,
  main
};

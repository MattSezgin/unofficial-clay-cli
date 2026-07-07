#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const {
  collectDeclaredInputs,
  collectProvidedInputKeys,
  discoverSpecTemplates,
  formatStructured,
  parseArgs,
  readStructured,
  summarizeInputs,
  writeStructured,
} = require('./plan-playbook');

const ROUTING_TERMS = {
  'people-from-companies': [
    'people', 'person', 'contacts', 'contact', 'job title', 'job titles', 'titles',
    'company names', 'companies', 'domain addresses', 'linkedin profile', 'linkedin',
    'find people', 'people from companies', 'current role',
  ],
  'outbound-personalization': [
    'personalization', 'personalisation', 'campaign', 'cold email', 'opener',
    'angle', 'persona', 'email angle', 'outbound', 'smartlead', 'first line',
  ],
  'source-to-ready-list': [
    'source list', 'icp', 'find companies', 'company source', 'account list',
    'lead list', 'prospect list', 'ready list', 'sourcing',
  ],
  'email-phone-waterfall': [
    'email', 'phone', 'waterfall', 'verify email', 'verification', 'provider',
    'cascade', 'catch-all', 'valid email', 'enrich emails',
  ],
  'crm-enrichment-export': [
    'crm', 'zoho', 'hubspot', 'attio', 'salesforce', 'export', 'import ready',
    'account enrichment', 'contact enrichment', 'row id',
  ],
  'webhook-enrichment': [
    'webhook', 'callback', 'endpoint', 'service', 'api action', 'n8n',
    'slack', 'incoming json', 'status callback',
  ],
  'table-audit-clone': [
    'audit', 'clone', 'repair', 'existing table', 'manifest', 'redact',
    'diff', 'parity', 'fix table',
  ],
};

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'build', 'can', 'create', 'do', 'for',
  'from', 'go', 'have', 'hey', 'i', 'in', 'into', 'it', 'like', 'me', 'need',
  'of', 'on', 'or', 'that', 'the', 'then', 'this', 'to', 'use', 'want', 'with',
  'workflow', 'workflows', 'clay', 'cli',
]);

function readMaybeFile(value) {
  if (!value) return '';
  const maybePath = path.resolve(String(value));
  if (fs.existsSync(maybePath) && fs.statSync(maybePath).isFile()) return fs.readFileSync(maybePath, 'utf8');
  return String(value);
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[_/-]+/g, ' ');
}

function tokenize(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !STOPWORDS.has(token));
}

function phraseMatches(haystack, phrases) {
  const found = [];
  for (const phrase of phrases || []) {
    const normalized = normalizeText(phrase).trim();
    if (normalized && haystack.includes(normalized)) found.push(phrase);
  }
  return found;
}

function playbookSearchText(playbook) {
  return [
    playbook.id,
    playbook.name,
    playbook.purpose,
    ...(collectDeclaredInputs(playbook.inputs).map(input => input.key)),
    ...((playbook.workflow || []).flatMap(step => [step.id, step.type, step.description])),
    ...((playbook.outputs?.readyColumns || [])),
    ...((playbook.outputs?.qaViews || [])),
    ...((playbook.knownFailureModes || [])),
  ].filter(Boolean).join(' ');
}

function scorePlaybook(requestText, playbook) {
  const request = normalizeText(requestText);
  const requestTokens = new Set(tokenize(requestText));
  const playbookTokens = new Set(tokenize(playbookSearchText(playbook)));
  const idTerms = ROUTING_TERMS[playbook.id] || [];
  const matchedRoutingTerms = phraseMatches(request, idTerms);
  const matchedInputTerms = collectDeclaredInputs(playbook.inputs)
    .map(input => input.key)
    .filter(key => request.includes(normalizeText(key).replace(/\s+/g, ' ')) || request.includes(normalizeText(key).replace(/\s+/g, '')));
  const matchedTokens = [...requestTokens].filter(token => playbookTokens.has(token));

  const exactNameMatch = request.includes(normalizeText(playbook.name)) || request.includes(normalizeText(playbook.id));
  const score = (exactNameMatch ? 20 : 0)
    + (matchedRoutingTerms.length * 6)
    + (matchedInputTerms.length * 4)
    + matchedTokens.length;

  return {
    playbook: {
      id: playbook.id,
      name: playbook.name,
      purpose: playbook.purpose,
    },
    score,
    confidence: score >= 20 ? 'high' : score >= 10 ? 'medium' : 'low',
    matched: {
      exactNameMatch,
      routingTerms: matchedRoutingTerms.sort(),
      inputTerms: matchedInputTerms.sort(),
      tokens: matchedTokens.sort().slice(0, 20),
    },
    specTemplates: discoverSpecTemplates(playbook.id),
  };
}

function loadPlaybooks(dir = path.join(__dirname, 'playbooks')) {
  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.yaml') || file.endsWith('.json'))
    .sort()
    .map(file => ({ file: path.join(dir, file), doc: readStructured(path.join(dir, file)) }))
    .filter(item => item.doc && item.doc.id);
}

function buildMissingInputQuestions(playbook, inputDoc = {}) {
  const provided = collectProvidedInputKeys(inputDoc);
  return collectDeclaredInputs(playbook.inputs)
    .filter(input => input.required && !provided.has(input.key))
    .map(input => ({
      key: input.key,
      section: input.section,
      question: `Provide the ${input.section} value or source column for ${input.key}.`,
      valuePolicy: 'Do not include client row values in committed artifacts; use an ignored local input file for real data.',
    }));
}

function buildIntake(requestText, opts = {}) {
  const playbooks = loadPlaybooks(opts.playbooksDir);
  if (!playbooks.length) throw new Error('no playbooks found');

  const scored = playbooks
    .map(item => ({ ...scorePlaybook(requestText, item.doc), file: path.relative(__dirname, item.file), doc: item.doc }))
    .sort((a, b) => b.score - a.score || a.playbook.id.localeCompare(b.playbook.id));

  const selected = scored[0];
  const inputDoc = opts.inputs ? readStructured(opts.inputs) : {};
  const inputSummary = summarizeInputs(selected.doc, inputDoc);
  const missingInputQuestions = buildMissingInputQuestions(selected.doc, inputDoc);
  const templateSelector = selected.specTemplates[0] ? path.basename(selected.specTemplates[0]) : '<template-basename-or-index>';
  const inputFlag = opts.inputs ? ` --inputs ${path.relative(__dirname, opts.inputs)}` : ' --inputs <ignored-or-example-input.yaml>';

  return {
    artifactVersion: 1,
    mode: 'offline-request-intake',
    generatedAt: new Date().toISOString(),
    request: {
      text: requestText,
      valuePolicy: 'Request text is operator-provided context. Do not include client row values or secrets in committed requests.',
    },
    routing: {
      selectedPlaybook: {
        id: selected.playbook.id,
        name: selected.playbook.name,
        file: selected.file,
        confidence: selected.confidence,
        score: selected.score,
        matched: selected.matched,
        specTemplates: selected.specTemplates,
      },
      alternatives: scored.slice(1, 4).map(item => ({
        id: item.playbook.id,
        name: item.playbook.name,
        file: item.file,
        confidence: item.confidence,
        score: item.score,
        matched: item.matched,
      })),
      ambiguity: selected.score === 0 || (scored[1] && selected.score - scored[1].score < 4)
        ? 'review-required'
        : 'acceptable',
    },
    inputSummary,
    missingInputQuestions,
    nextCommands: {
      plan: `node plan-playbook.js ${selected.file}${inputFlag} --json`,
      sampleRunPacket: `node plan-playbook.js ${selected.file}${inputFlag} --sample-run ${templateSelector} --out runs/<date>/${selected.playbook.id}-sample-run.json`,
      preflight: `node preflight-sample-run.js runs/<date>/${selected.playbook.id}-sample-run.json --config <config.yaml> --profile <profile> --workspace <workspace-id> --folder <sandbox-folder-id> --workbook <sandbox-workbook-id> --out runs/<date>/${selected.playbook.id}-preflight.json`,
    },
    stopConditions: [
      'routing ambiguity is review-required',
      'missing required inputs are unresolved',
      'no matching spec template exists',
      'profile validation fails before preflight',
    ],
    valuePolicy: 'This artifact contains request text and input keys only. Keep real client inputs in ignored files.',
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const requestText = flags.request ? readMaybeFile(flags.request) : flags._.join(' ');
  if (!requestText || flags.help) {
    console.log('Usage: node intake-request.js --request "Find people at these companies by job title" [--inputs input.yaml] [--out intake.json|yaml] [--json]');
    return;
  }

  const intake = buildIntake(requestText, {
    inputs: flags.inputs ? path.resolve(flags.inputs) : null,
    playbooksDir: flags['playbooks-dir'] ? path.resolve(flags['playbooks-dir']) : undefined,
  });

  if (flags.out) {
    console.log(JSON.stringify(writeStructured(intake, flags.out), null, 2));
    return;
  }

  if (flags.json) process.stdout.write(JSON.stringify(intake, null, 2) + '\n');
  else process.stdout.write(formatStructured(intake));
}

if (require.main === module) main();

module.exports = {
  buildIntake,
  buildMissingInputQuestions,
  loadPlaybooks,
  phraseMatches,
  playbookSearchText,
  scorePlaybook,
  tokenize,
};

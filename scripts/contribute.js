#!/usr/bin/env node
/**
 * contribute.js - the guided share wizard. `npm run share`
 *
 * Turns a Clay workflow you built into a community template SAFELY:
 *   - it REBUILDS a clean template (structure, logic, placeholders); it never
 *     copies raw column config, where API keys and client data hide
 *   - anything shaped like a real ID, key, URL-with-token, or email becomes a
 *     placeholder automatically
 *   - you see a full preview of exactly what would be published, and nothing
 *     is written until you approve
 *   - the safety scanner + schema validator run before the wizard finishes
 *
 * Works two ways:
 *   npm run share                          guided from scratch
 *   npm run share -- --from my-spec.yaml   rebuild from an export-spec file
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'community', 'templates');
const CONTRIBUTORS_DIR = path.join(ROOT, 'community', 'contributors');
const CATEGORIES = ['enrichment', 'scoring', 'sourcing', 'outreach-prep', 'crm-sync', 'data-cleaning', 'qa', 'other'];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, a => resolve(a.trim())));

async function askRequired(q, validator, hint) {
  for (;;) {
    const answer = await ask(q);
    if (validator(answer)) return answer;
    console.log(`  ${hint}`);
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,60}$/;
const VAR_NAME_RE = /^[a-z][a-z0-9_]{0,40}$/;

/** Anything secret/ID/PII-shaped becomes a placeholder. Rebuild, never copy. */
function scrubValue(raw, fallbackVar) {
  const s = String(raw == null ? '' : raw);
  if (/^\{\{[a-z][a-z0-9_]{0,40}\}\}$/.test(s) || /^\$\{[A-Z][A-Z0-9_]{0,40}\}$/.test(s)) return s;
  const dirty =
    /\b(t|wb|gv|f|aa|s)_0[A-Za-z0-9]{10,}\b/.test(s) ||       // real Clay IDs
    /https?:\/\//.test(s) || /[:/@\\]/.test(s) ||               // URLs, paths, emails
    /\b(sk-|xox[baprs]-|gh[pousr]_|AKIA|eyJ)/.test(s) ||        // key formats
    s.length > 120;
  if (dirty) return `{{${fallbackVar}}}`;
  return s;
}

function rebuildFromSpec(specFile) {
  const spec = YAML.parse(fs.readFileSync(specFile, 'utf8'));
  const fields = spec.fields || spec.columns || [];
  const steps = [];
  const inputs = new Map();
  for (const field of fields) {
    const name = field.name || field.field || 'Unnamed Field';
    const type = String(field.type || '').toLowerCase();
    const kind = type.includes('use-ai') || type === 'use-ai' ? 'use-ai'
      : type === 'formula' ? 'formula'
      : type.includes('http') ? 'http-placeholder'
      : field.actionKey || field.action_key ? 'action'
      : 'formula';
    const step = { field: String(name).slice(0, 80), kind };
    if (kind === 'action') step.action_key = String(field.actionKey || field.action_key);
    const bindings = field.inputs || field.inputsBinding || field.inputs_binding || {};
    if (bindings && typeof bindings === 'object' && !Array.isArray(bindings)) {
      step.inputs_binding = {};
      for (const [key, value] of Object.entries(bindings).slice(0, 30)) {
        const safeKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, 'x').slice(0, 60);
        const varName = safeKey || 'value';
        step.inputs_binding[safeKey] = scrubValue(value, varName);
        const m = /^\{\{([a-z][a-z0-9_]{0,40})\}\}$/.exec(step.inputs_binding[safeKey]);
        if (m) inputs.set(m[1], { name: m[1], type: 'text', required: false });
      }
    }
    if (kind === 'use-ai' && (field.prompt || (field.typeSettings && field.typeSettings.prompt))) {
      let prompt = String(field.prompt || field.typeSettings.prompt).slice(0, 4000);
      prompt = prompt
        .replace(/\b(t|wb|gv|f|aa|s)_0[A-Za-z0-9]{10,}\b/g, '{{table_reference}}')
        .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '{{email}}')
        .replace(/https?:\/\/[^\s"')]+/g, '{{url}}');
      step.prompt_contract = prompt;
      console.log(`  [note] step "${step.field}": reread the AI prompt in the preview - prompts often remember company names.`);
    }
    if (kind === 'http-placeholder') {
      step.notes = 'HTTP step intentionally stripped to a placeholder - configure your own endpoint and keep credentials in env vars, never in the column.';
    }
    steps.push(step);
  }
  return { steps: steps.slice(0, 40), inputs: [...inputs.values()] };
}

async function collectProfile() {
  console.log('\n-- Contributor profile (optional, recommended) --');
  console.log('A public page with your name, company, and LinkedIn. Your templates');
  console.log('link to it, and vote totals rank you on the front page.');
  const wants = (await ask('Create a public profile? [Y/n] ')).toLowerCase();
  if (wants === 'n' || wants === 'no') return null;
  const github = await askRequired('Your GitHub handle: ', a => /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(a), 'That does not look like a GitHub handle.');
  const first = await askRequired('First name: ', a => a.length >= 1 && a.length <= 40, '1-40 characters.');
  const last = await ask('Last name (optional): ');
  const company = await ask('Company (optional): ');
  const role = await ask('Role (optional): ');
  const linkedin = await askRequired('LinkedIn URL (https://www.linkedin.com/in/...): ', a => a === '' || /^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]{1,100}\/?$/.test(a), 'Only linkedin.com/in/... URLs are accepted (or leave empty).');
  const profile = { github, first_name: first };
  if (last) profile.last_name = last;
  if (company) profile.company = company;
  if (role) profile.role = role;
  if (linkedin) profile.linkedin = linkedin;
  return profile;
}

async function main() {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf('--from');
  const specFile = fromIdx !== -1 ? args[fromIdx + 1] : null;

  console.log('\nShare a Clay workflow with the community');
  console.log('=========================================');
  console.log('This wizard rebuilds your workflow as a clean template. Nothing is');
  console.log('published by this tool - it only writes files locally, shows you exactly');
  console.log('what they contain, and tells you how to open a pull request.\n');

  const id = await askRequired('Template id (kebab-case, e.g. founder-email-waterfall): ', a => SLUG_RE.test(a), 'Lowercase letters, numbers, dashes; 3-60 chars.');
  if (fs.existsSync(path.join(TEMPLATES_DIR, id))) { console.log(`A template with id '${id}' already exists.`); process.exit(1); }
  const title = await askRequired('Title: ', a => a.length >= 4 && a.length <= 80, '4-80 characters.');
  const category = await askRequired(`Category (${CATEGORIES.join(' | ')}): `, a => CATEGORIES.includes(a), 'Pick one from the list.');
  const description = await askRequired('What does it do and when should someone use it? (1-3 sentences)\n> ', a => a.length >= 20 && a.length <= 600, '20-600 characters.');
  const credits = await ask('Rough credit cost per row (optional, e.g. "~2 credits/row"): ');

  let steps = [];
  let inputs = [];
  if (specFile) {
    console.log(`\nRebuilding from ${specFile} (values are scrubbed, config is never copied)...`);
    ({ steps, inputs } = rebuildFromSpec(path.resolve(specFile)));
    console.log(`  ${steps.length} step(s) reconstructed, ${inputs.length} input variable(s) detected.`);
  } else {
    console.log('\n-- Describe the input columns a user needs (blank name to finish) --');
    for (;;) {
      const name = await ask(`Input ${inputs.length + 1} name (snake_case, blank to finish): `);
      if (!name) break;
      if (!VAR_NAME_RE.test(name)) { console.log('  snake_case, starts with a letter.'); continue; }
      const type = await askRequired('  type (text|url|number|email-like|select): ', a => ['text', 'url', 'number', 'email-like', 'select'].includes(a), '  pick one.');
      inputs.push({ name, type, required: true });
    }
    console.log('\n-- Describe the steps (blank field name to finish) --');
    for (;;) {
      const field = await ask(`Step ${steps.length + 1} column name (blank to finish): `);
      if (!field) break;
      const kind = await askRequired('  kind (action|formula|use-ai|http-placeholder|lookup|source): ', a => ['action', 'formula', 'use-ai', 'http-placeholder', 'lookup', 'source'].includes(a), '  pick one.');
      const step = { field, kind };
      if (kind === 'action') step.action_key = await askRequired('  action key (from integration-library/registry.yaml): ', a => /^[a-z0-9][a-z0-9-]{1,80}$/.test(a), '  kebab-case action key.');
      const note = await ask('  note for users (optional): ');
      if (note) step.notes = note;
      steps.push(step);
    }
  }
  if (!steps.length) { console.log('A template needs at least one step. Nothing written.'); process.exit(1); }
  if (!inputs.length) inputs = [{ name: 'input_value', type: 'text', required: true }];

  const profile = await collectProfile();
  const author = profile ? profile.github : 'anonymous';

  const template = { id, title, author, category, description };
  if (credits) template.credits_note = credits;
  template.inputs = inputs;
  template.steps = steps;
  template.first_run = {
    sample_rows: 10,
    quality_checks: ['Spot-check the first 10 rows by hand before scaling up.'],
  };

  const templateYaml = YAML.stringify(template);
  const profileYaml = profile ? YAML.stringify(profile) : null;

  console.log('\n================ PREVIEW - exactly what will be shared ================\n');
  console.log(`community/templates/${id}/template.yaml\n${'-'.repeat(50)}`);
  console.log(templateYaml);
  if (profileYaml) {
    console.log(`community/contributors/${author}/profile.yaml\n${'-'.repeat(50)}`);
    console.log(profileYaml);
  }
  console.log('========================================================================');
  console.log('Read the preview like a stranger would. Company names in prompts? Real');
  console.log('IDs? Anything you would not put on a billboard?\n');

  const go = (await ask('Write these files? [y/N] ')).toLowerCase();
  if (go !== 'y' && go !== 'yes') { console.log('Nothing written.'); rl.close(); return; }

  fs.mkdirSync(path.join(TEMPLATES_DIR, id), { recursive: true });
  fs.writeFileSync(path.join(TEMPLATES_DIR, id, 'template.yaml'), templateYaml);
  if (profile) {
    fs.mkdirSync(path.join(CONTRIBUTORS_DIR, author), { recursive: true });
    fs.writeFileSync(path.join(CONTRIBUTORS_DIR, author, 'profile.yaml'), profileYaml);
  }

  console.log('\nRunning the safety scanner and schema validator...');
  try {
    execFileSync('node', [path.join(ROOT, 'scripts', 'scan-repo.js')], { stdio: 'inherit' });
    execFileSync('node', [path.join(ROOT, 'scripts', 'validate-community.js')], { stdio: 'inherit' });
  } catch {
    console.log('\n[STOP] Fix the findings above (edit the files, or delete the folder to start over).');
    console.log('The same checks run on your pull request - it cannot merge until they pass.');
    rl.close();
    process.exit(1);
  }

  console.log('\n[OK] All checks passed. To publish:');
  console.log(`  git checkout -b share/${id}`);
  console.log(`  git add community/templates/${id}/${profile ? ` community/contributors/${author}/` : ''}`);
  console.log(`  git commit -m "template: ${title}"`);
  console.log('  git push and open a pull request');
  console.log('\nAfter merge, your template gets a voting thread automatically - share the');
  console.log('link and thumbs-up votes move it up the front-page leaderboard.');
  rl.close();
}

main().catch(err => { console.error(`[FAIL] ${err.message}`); rl.close(); process.exit(1); });

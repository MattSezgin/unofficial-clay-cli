#!/usr/bin/env node

const fs = require('fs');
let YAML;
try { YAML = require('yaml'); } catch { YAML = null; }

const SECRET_PATTERNS = [
  /claysession/i,
  /apiToken/i,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /sk-[A-Za-z0-9._-]+/i,
  /xox[baprs]-[A-Za-z0-9._-]+/i,
  /https:\/\/hooks\.slack\.com\//i,
  /s%3A[A-Za-z0-9._-]{20,}/i,
];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) args[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[arg.slice(2)] = argv[++i];
    else args[arg.slice(2)] = true;
  }
  return args;
}

function readStructured(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (/\.ya?ml$/i.test(file)) {
    if (!YAML) throw new Error('YAML dependency is unavailable; use JSON input or run npm install in the repo root');
    return YAML.parse(text);
  }
  return JSON.parse(text);
}

function findSecrets(value, at = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSecrets(item, `${at}[${index}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) findSecrets(val, `${at}.${key}`, found);
    return found;
  }
  if (typeof value === 'string') {
    const pattern = SECRET_PATTERNS.find(re => re.test(value));
    if (pattern) found.push({ path: at, pattern: String(pattern) });
  }
  return found;
}

function validateSpecObject(spec) {
  const issues = [];
  if (!spec || typeof spec !== 'object') issues.push({ severity: 'error', type: 'invalid_spec', message: 'spec must be an object' });
  if (!spec.table?.id && !spec.table?.name) issues.push({ severity: 'error', type: 'missing_table', message: 'table.id or table.name required' });
  if (!Array.isArray(spec.fields)) issues.push({ severity: 'error', type: 'missing_fields', message: 'fields must be an array' });
  for (const field of spec.fields || []) {
    if (!field.name) issues.push({ severity: 'error', type: 'field_missing_name' });
    if (field.type === 'action' || field.actionKey) {
      if (!field.actionKey) issues.push({ severity: 'error', type: 'action_missing_actionKey', fieldName: field.name });
      if (!field.actionPackageId) issues.push({ severity: 'warning', type: 'action_missing_actionPackageId', fieldName: field.name });
      if (!field.inputs || typeof field.inputs !== 'object') issues.push({ severity: 'error', type: 'action_missing_inputs_object', fieldName: field.name });
    }
    for (const output of field.outputs || []) {
      if (!output.name || !output.path) issues.push({ severity: 'error', type: 'output_missing_name_or_path', fieldName: field.name });
    }
  }
  return { valid: !issues.some(issue => issue.severity === 'error'), issueCount: issues.length, issues };
}

function slugify(value) {
  return String(value || 'action')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'action';
}

function isAuthRequired(action) {
  if (action.auth && action.auth.optional !== true) return true;
  const labels = action.actionLabels || {};
  if (!Object.prototype.hasOwnProperty.call(labels, 'requiresApiKey')) return false;
  return labels.requiresApiKey !== false && labels.requiresApiKey !== 'false' && labels.requiresApiKey != null;
}

function actionTypes(action) {
  const type = action.actionLabels?.type;
  if (Array.isArray(type)) return type;
  return type ? [type] : [];
}

function inputKind(input) {
  if (!input || !input.name) return 'unknown';
  if (input.authDependent || input.requiresAuth || input.isAuth || /auth|api.?key|token|secret|password/i.test(input.name)) return 'authDependent';
  if (input.optional === true) return 'optional';
  return 'required';
}

function summarizeInput(input) {
  return {
    name: input.name || '<unknown>',
    displayName: input.displayName,
    type: input.type || input.typeSettings?.type || 'unknown',
    semanticType: input.typeSettings?.semanticType,
    description: input.description,
  };
}

function partitionInputs(action) {
  const groups = { required: [], optional: [], unknown: [], authDependent: [] };
  const schema = Array.isArray(action.inputParameterSchema) ? action.inputParameterSchema : null;
  if (!schema) {
    groups.unknown.push({ name: '<inputParameterSchema>', reason: 'missing inputParameterSchema array' });
    return groups;
  }
  for (const input of schema) {
    const kind = inputKind(input);
    groups[kind].push(kind === 'unknown' ? { raw: input, reason: 'input is missing a stable name' } : summarizeInput(input));
  }
  return groups;
}

function placeholderFor(input) {
  return `\${${`CLAY_INPUT_${String(input.name).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`}:-}`;
}

function outputPath(output) {
  if (!output?.name) return undefined;
  return output.path || output.name;
}

function buildSpecFragment(action, groups) {
  const inputs = {};
  for (const input of [...groups.required, ...groups.optional]) inputs[input.name] = placeholderFor(input);

  const outputs = (Array.isArray(action.outputParameterSchema) ? action.outputParameterSchema : [])
    .filter(output => output && output.name)
    .slice(0, 10)
    .map(output => ({ name: output.displayName || output.name, type: output.type || 'text', path: outputPath(output) }));

  const field = {
    name: `${action.displayName || action.key || 'Action'} (template)`,
    type: 'action',
    actionKey: action.key,
    actionPackageId: action.package?.id,
    actionVersion: action.version || 1,
    inputs,
  };
  if (isAuthRequired(action)) field.authAccountId = '${CLAY_AUTH_ACCOUNT_ID:-}';
  if (outputs.length) field.outputs = outputs;

  return {
    claySpecVersion: 1,
    table: { name: `${slugify(action.key)}-template`, type: 'spreadsheet' },
    fields: [field],
  };
}

function validateTemplate(template) {
  const issues = [];
  const specResult = validateSpecObject(template.specFragment);
  issues.push(...specResult.issues);
  issues.push(...findSecrets(template).map(item => ({ severity: 'error', type: 'secret_like_value', ...item })));
  if (template.inputSurface.unknown.length) {
    issues.push({ severity: 'warning', type: 'unknown_inputs_present', message: 'Template contains warnings and no invented values for unknown inputs.' });
  }
  return { valid: !issues.some(issue => issue.severity === 'error'), issueCount: issues.length, issues };
}

function generateTemplate(action) {
  if (!action || typeof action !== 'object') throw new Error('action must be an object');
  const groups = partitionInputs(action);
  const authRequired = isAuthRequired(action);
  const template = {
    templateVersion: 1,
    action: {
      key: action.key,
      version: action.version || 1,
      displayName: action.displayName,
      packageId: action.package?.id,
      packageDisplayName: action.package?.displayName,
      types: actionTypes(action),
    },
    safety: {
      status: 'offline-template-only',
      warnings: [
        'Generated from catalog metadata only; this is not strict battle-tested proof.',
        'Do not apply or run without operator review, auth confirmation, and live proof evidence.',
        'Placeholders are intentionally blank; missing payloads are not invented.',
      ],
    },
    proof: {
      status: 'catalog-derived-unproven',
      source: 'actions catalog inputParameterSchema/outputParameterSchema',
    },
    inputSurface: groups,
    auth: {
      required: authRequired,
      providerType: action.auth?.providerType,
      authDependentInputs: groups.authDependent,
      warning: authRequired ? 'Requires a workspace auth account; generated authAccountId is an unresolved placeholder.' : undefined,
    },
    specFragment: buildSpecFragment(action, groups),
  };
  template.validation = validateTemplate(template);
  return template;
}

function generateTemplates(catalog, opts = {}) {
  const actions = Array.isArray(catalog) ? catalog : catalog.actions;
  if (!Array.isArray(actions)) throw new Error('catalog must be an array or { actions: [] }');
  const limit = opts.limit ? Number(opts.limit) : actions.length;
  const query = opts.query ? String(opts.query).toLowerCase() : '';
  return actions
    .filter(action => !query || JSON.stringify({ key: action.key, displayName: action.displayName, package: action.package?.displayName }).toLowerCase().includes(query))
    .slice(0, limit)
    .map(generateTemplate);
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const input = flags._[0];
  if (!input || flags.help) {
    console.log('Usage: node lib/action-template-generator.js <actions-catalog.json> [--query text] [--limit n] [--format json|yaml] [--out file]');
    return;
  }
  const catalog = readStructured(input);
  const result = { generatedAt: new Date().toISOString(), templates: generateTemplates(catalog, flags) };
  if (flags.format === 'yaml' && !YAML) throw new Error('YAML dependency is unavailable; omit --format yaml or run npm install in the repo root');
  const text = flags.format === 'yaml' ? YAML.stringify(result) : JSON.stringify(result, null, 2);
  if (flags.out) fs.writeFileSync(flags.out, text + '\n');
  else process.stdout.write(text + '\n');
}

if (require.main === module) main();

module.exports = { generateTemplate, generateTemplates, partitionInputs, validateTemplate, isAuthRequired };

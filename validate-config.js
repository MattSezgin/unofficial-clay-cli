#!/usr/bin/env node

const fs = require('fs');
const YAML = require('yaml');

const SECRET_PATTERNS = [
  /claysession/i,
  /apiToken/i,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /sk-[A-Za-z0-9._-]+/i,
  /xox[baprs]-[A-Za-z0-9._-]+/i,
  /https:\/\/hooks\.slack\.com\//i,
  /https:\/\/api\.clay\.com\/v3\/sources\/webhook/i,
  /s%3A[A-Za-z0-9._-]{20,}/i,
];

function parseArgs(argv) {
  const args = { _: [] };
  const setArg = (key, value) => {
    if (args[key] === undefined) args[key] = value;
    else if (Array.isArray(args[key])) args[key].push(value);
    else args[key] = [args[key], value];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) setArg(a.slice(2, eq), a.slice(eq + 1));
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) setArg(a.slice(2), argv[++i]);
      else setArg(a.slice(2), true);
    } else args._.push(a);
  }
  return args;
}

function parseEnvOverrides(values = []) {
  const env = {};
  for (const item of Array.isArray(values) ? values : [values]) {
    const eq = String(item).indexOf('=');
    if (eq === -1) throw new Error(`--env expects KEY=VALUE, got: ${item}`);
    const key = String(item).slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid env key: ${key}`);
    env[key] = String(item).slice(eq + 1);
  }
  return env;
}

function readStructured(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (/\.ya?ml$/i.test(file)) return YAML.parse(text);
  return JSON.parse(text);
}

function resolveEnvPlaceholders(value, env = process.env) {
  if (Array.isArray(value)) return value.map(item => resolvePlaceholders(item, env));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, resolveEnvPlaceholders(val, env)]));
  }
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (match, name, fallback) => {
    if (env[name] !== undefined && env[name] !== '') return env[name];
    if (fallback !== undefined) return fallback;
    return match;
  });
}

// Backwards-compatible local alias for the recursive calls above.
const resolvePlaceholders = resolveEnvPlaceholders;

function findUnresolved(value, at = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findUnresolved(item, `${at}[${index}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) findUnresolved(val, `${at}.${key}`, found);
    return found;
  }
  if (typeof value === 'string' && /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/.test(value)) found.push({ path: at, value });
  return found;
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

function normalizeProfile(profile, opts = {}) {
  const env = { ...(opts.env || process.env), ...parseEnvOverrides(opts.envOverride || []) };
  const resolved = resolveEnvPlaceholders(profile, env);
  if (opts.workspace) resolved.workspaceId = opts.workspace;
  if (opts.folder) resolved.testFolderId = opts.folder;
  if (opts.workbook) resolved.defaultWorkbookId = opts.workbook;
  return resolved;
}

function validateProfile(config, opts = {}) {
  const profileName = opts.profile || 'default';
  const profile = config.profiles?.[profileName];
  const issues = [];

  if (!profile) {
    return {
      valid: false,
      profile: profileName,
      issueCount: 1,
      issues: [{ severity: 'error', type: 'missing_profile', message: `profile not found: ${profileName}` }],
    };
  }

  const resolved = normalizeProfile(profile, opts);
  const unresolvedSeverity = opts.requireResolved ? 'error' : 'warning';
  const unresolved = findUnresolved(resolved).map(item => ({
    severity: opts.requireWorkbook === false && item.path === '$.defaultWorkbookId' ? 'warning' : unresolvedSeverity,
    type: 'unresolved_placeholder',
    ...item,
  }));
  issues.push(...unresolved);
  issues.push(...findSecrets(resolved).map(item => ({ severity: 'error', type: 'secret_like_value', ...item })));

  const requiredProfileKeys = ['workspaceId', 'testFolderId'];
  if (opts.requireWorkbook !== false) requiredProfileKeys.push('defaultWorkbookId');
  for (const key of requiredProfileKeys) {
    if (!resolved[key]) issues.push({ severity: 'error', type: 'missing_required_profile_key', key });
  }

  const maxSampleRows = Number(resolved.maxSampleRows);
  if (!Number.isFinite(maxSampleRows) || maxSampleRows > 10) {
    issues.push({ severity: 'error', type: 'invalid_max_sample_rows', message: 'maxSampleRows must be <= 10' });
  }

  const requiredConfirmations = ['mutating', 'credit-consuming', 'source-preview', 'source-import'];
  const confirmations = new Set(resolved.requireChatConfirmationFor || []);
  for (const item of requiredConfirmations) {
    if (!confirmations.has(item)) issues.push({ severity: 'error', type: 'missing_confirmation_gate', item });
  }

  if (opts.requirePinnedScope) {
    // Drift protection: the resolved profile must match the operator's pinned
    // sandbox scope from the environment (CLAY_WORKSPACE_ID / CLAY_FOLDER_ID).
    const pinnedWorkspace = process.env.CLAY_WORKSPACE_ID;
    const pinnedFolder = process.env.CLAY_FOLDER_ID;
    if (!pinnedWorkspace) {
      issues.push({ severity: 'error', type: 'no_pinned_scope', message: 'require-pinned-scope is on but CLAY_WORKSPACE_ID is not set' });
    } else {
      if (String(resolved.workspaceId) !== String(pinnedWorkspace)) {
        issues.push({ severity: 'error', type: 'wrong_workspace', expected: String(pinnedWorkspace), actual: resolved.workspaceId });
      }
      if (pinnedFolder && String(resolved.testFolderId) !== String(pinnedFolder)) {
        issues.push({ severity: 'error', type: 'wrong_test_folder', expected: String(pinnedFolder), actual: resolved.testFolderId });
      }
    }
  }

  return {
    valid: !issues.some(issue => issue.severity === 'error'),
    profile: profileName,
    resolved: {
      workspaceId: resolved.workspaceId,
      testFolderId: resolved.testFolderId,
      defaultWorkbookId: resolved.defaultWorkbookId,
      defaultModel: resolved.defaultModel,
      maxSampleRows: resolved.maxSampleRows,
      requireChatConfirmationFor: resolved.requireChatConfirmationFor || [],
    },
    unresolved: unresolved.map(item => item.path),
    issueCount: issues.length,
    issues,
  };
}

function loadConfigProfile(file, opts = {}) {
  const config = readStructured(file);
  return validateProfile(config, opts);
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const file = flags._[0];
  if (!file || flags.help) {
    console.log('Usage: node validate-config.js <config.yaml|json> [--profile default] [--require-resolved] [--require-pinned-scope] [--workspace ID] [--folder ID] [--workbook ID] [--env KEY=VALUE]');
    return;
  }

  const result = loadConfigProfile(file, {
    profile: flags.profile || 'default',
    requireResolved: !!flags['require-resolved'],
    requirePinnedScope: !!flags['require-pinned-scope'],
    workspace: flags.workspace,
    folder: flags.folder,
    workbook: flags.workbook,
    requireWorkbook: flags['require-workbook'] !== false && !flags['no-require-workbook'],
    envOverride: flags.env,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.valid) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  findSecrets,
  findUnresolved,
  loadConfigProfile,
  normalizeProfile,
  parseArgs,
  readStructured,
  resolveEnvPlaceholders,
  validateProfile,
};

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const {
  findSecrets,
  findUnresolved,
  normalizeProfile,
  parseArgs,
  readStructured,
  validateProfile,
} = require('./validate-config');

function extractEnvRefs(value, found = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => extractEnvRefs(item, found));
    return found;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => extractEnvRefs(item, found));
    return found;
  }
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g)) found.add(match[1]);
  }
  return found;
}

function parseEnvOverrides(values = []) {
  const env = {};
  for (const item of Array.isArray(values) ? values : [values]) {
    if (!item) continue;
    const eq = String(item).indexOf('=');
    if (eq === -1) throw new Error(`--env expects KEY=VALUE, got: ${item}`);
    const key = String(item).slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid env key: ${key}`);
    env[key] = String(item).slice(eq + 1);
  }
  return env;
}

function redactValue(value) {
  if (value === undefined || value === null || value === '') return { state: 'missing', display: null };
  const text = String(value);
  if (/\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/.test(text)) return { state: 'unresolved', display: '<unresolved>' };
  return { state: 'present', display: `<redacted:${text.length}>` };
}

function sanitizeIssue(issue) {
  const copy = { ...issue };
  for (const key of ['actual', 'expected', 'value']) {
    if (copy[key] !== undefined) copy[key] = redactValue(copy[key]).display || '<missing>';
  }
  return copy;
}

function summarizeProfile(rawProfile, opts = {}) {
  const env = { ...(opts.env || process.env), ...parseEnvOverrides(opts.envOverride || []) };
  const resolved = normalizeProfile(rawProfile, { ...opts, env });
  const envRefs = [...extractEnvRefs(rawProfile)].sort();
  const envStatus = envRefs.map(name => {
    const value = env[name];
    return {
      name,
      present: value !== undefined && value !== '',
      value: value !== undefined && value !== '' ? `<redacted:${String(value).length}>` : null,
    };
  });
  const runtimeKeys = ['workspaceId', 'testFolderId', 'defaultWorkbookId', 'defaultModel', 'maxSampleRows'];
  const runtime = Object.fromEntries(runtimeKeys.map(key => [key, redactValue(resolved[key])]));
  return {
    envRefs,
    envStatus,
    missingEnv: envStatus.filter(item => !item.present).map(item => item.name),
    unresolved: findUnresolved(resolved),
    secretLikeValues: findSecrets(resolved),
    runtime,
  };
}

function buildProfileContext(file, opts = {}) {
  const config = readStructured(file);
  const profileName = opts.profile || 'default';
  const profile = config.profiles?.[profileName];
  if (!profile) {
    return {
      artifactVersion: 1,
      mode: 'offline-profile-context',
      generatedAt: new Date().toISOString(),
      profile: profileName,
      valid: false,
      issueCount: 1,
      issues: [{ severity: 'error', type: 'missing_profile', message: `profile not found: ${profileName}` }],
    };
  }

  const env = { ...(opts.env || process.env) };
  const summary = summarizeProfile(profile, {
    env,
    envOverride: opts.envOverride,
    workspace: opts.workspace,
    folder: opts.folder,
    workbook: opts.workbook,
  });
  const validation = validateProfile(config, {
    profile: profileName,
    requireResolved: !!opts.requireResolved,
    requirePinnedScope: !!opts.requirePinnedScope,
    workspace: opts.workspace,
    folder: opts.folder,
    workbook: opts.workbook,
    envOverride: opts.envOverride,
    env,
  });

  return {
    artifactVersion: 1,
    mode: 'offline-profile-context',
    generatedAt: new Date().toISOString(),
    profile: profileName,
    valid: validation.valid,
    issueCount: validation.issueCount,
    issues: validation.issues.map(sanitizeIssue),
    env: {
      referenced: summary.envRefs,
      missing: summary.missingEnv,
      status: summary.envStatus,
      template: summary.envRefs.map(name => `${name}=<set-locally>`),
    },
    runtime: summary.runtime,
    unresolved: summary.unresolved.map(item => ({ path: item.path, value: '<unresolved>' })),
    secretLikeValueCount: summary.secretLikeValues.length,
    safety: {
      rawValuesPrinted: false,
      valuePolicy: 'This command reports presence and redacted lengths only. Keep real IDs in ignored local config or environment variables.',
      noClayCommandsExecuted: true,
    },
  };
}

function writeStructured(data, file) {
  const text = /\.ya?ml$/i.test(file) ? YAML.stringify(data) : JSON.stringify(data, null, 2) + '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { wrote: file, bytes: Buffer.byteLength(text) };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const file = flags._[0];
  if (!file || flags.help) {
    console.log('Usage: node profile-context.js <config.yaml|json> [--profile default] [--require-resolved] [--require-pinned-scope] [--workspace ID] [--folder ID] [--workbook ID] [--env KEY=VALUE] [--out context.json]');
    return;
  }

  const context = buildProfileContext(file, {
    profile: flags.profile || 'default',
    requireResolved: !!flags['require-resolved'],
    requirePinnedScope: !!flags['require-pinned-scope'],
    workspace: flags.workspace,
    folder: flags.folder,
    workbook: flags.workbook,
    envOverride: flags.env,
  });
  if (flags.out) {
    console.log(JSON.stringify(writeStructured(context, path.resolve(flags.out)), null, 2));
    return;
  }
  if (flags.json) process.stdout.write(JSON.stringify(context, null, 2) + '\n');
  else process.stdout.write(YAML.stringify(context));
  if (!context.valid && flags['fail-on-invalid']) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  buildProfileContext,
  extractEnvRefs,
  redactValue,
  sanitizeIssue,
  summarizeProfile,
};

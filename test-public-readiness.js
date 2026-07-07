#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;

// Whole-tree scan. The old version scanned a whitelist of paths, which is how
// contamination accumulated in the folders it skipped - never again.
const SKIP_DIRS = new Set(['node_modules', '.git', '_audit', 'runs', 'exports', 'tmp']);
// Files whose PURPOSE is containing the forbidden shapes: the scanners that
// define them and the fixtures that test redaction. The Clay real-ID patterns
// still apply to fixtures - even fake fixtures must use TEST placeholders.
const PATTERN_DEFINITION_FILES = new Set([
  path.join('scripts', 'scan-repo.js'),
  'test-public-readiness.js',
  'test-redaction.js',
  path.join('test', 'redaction-input.json'),
  'test-proof-packet.js',
  'test-validate-config.js', // fixture cookie 's%3A...ForTestsOnly' proves rejection works

  path.join('community', 'schemas', 'template.schema.json'),
  path.join('.gitleaks.toml'),
]);

const clayIdPatterns = [
  /\baa_0[A-Za-z0-9]{10,}\b/,
  /\bwb_0[A-Za-z0-9]{10,}\b/,
  /\bt_0[A-Za-z0-9]{10,}\b/,
  /\bgv_0[A-Za-z0-9]{10,}\b/,
  /\bf_0[A-Za-z0-9]{10,}\b/,
  /\bs_0[A-Za-z0-9]{10,}\b/,
];

const secretPatterns = [
  /claysession\s*[:=]\s*['"]?[A-Za-z0-9%._-]{12,}/i,
  /apiToken\s*[:=]\s*['"]?[A-Za-z0-9._-]{12,}/i,
  /Bearer\s+[A-Za-z0-9._-]{12,}/,
  /sk-[A-Za-z0-9._-]{20,}/,
  /xox[baprs]-[A-Za-z0-9._-]+/i,
  /https:\/\/hooks\.slack\.com\//i,
  /https:\/\/api\.clay\.com\/v3\/sources\/webhook/i,
  /s%3A[A-Za-z0-9._-]{20,}/i,
];

const generatedArtifactExtraPatterns = [
  /https:\/\/app\.clay\.com\/workspaces\/\d+/i,
];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name);
    }
  }
}

function assertNoForbidden(raw, label, patterns) {
  for (const pattern of patterns) {
    assert(!pattern.test(raw), `${label} matched forbidden pattern ${pattern}`);
  }
}

let scanned = 0;
for (const file of walk(root)) {
  if (!/\.(ya?ml|json|md|js|py|toml)$/.test(file) && path.basename(file) !== '.gitignore' && path.basename(file) !== '.env.example') continue;
  const rel = path.relative(root, file);
  const raw = fs.readFileSync(file, 'utf8');
  scanned++;
  assertNoForbidden(raw, rel, clayIdPatterns);
  if (!PATTERN_DEFINITION_FILES.has(rel)) assertNoForbidden(raw, rel, secretPatterns);
}
assert(scanned > 100, `expected to scan the whole tree, scanned only ${scanned} files`);

// Generated artifacts must also come out clean.
const generatedChecks = [
  {
    label: 'generated plan',
    args: [path.join(root, 'plan-playbook.js'), path.join(root, 'playbooks', 'outbound-personalization.yaml'), '--inputs', path.join(root, 'examples', 'outbound-personalization-input.example.yaml'), '--json'],
  },
  {
    label: 'generated template plan',
    args: [path.join(root, 'plan-playbook.js'), path.join(root, 'playbooks', 'outbound-personalization.yaml'), '--inputs', path.join(root, 'examples', 'outbound-personalization-input.example.yaml'), '--template-plan', 'outbound-personalization.yaml', '--json'],
  },
  {
    label: 'generated sample-run packet',
    args: [path.join(root, 'plan-playbook.js'), path.join(root, 'playbooks', 'outbound-personalization.yaml'), '--inputs', path.join(root, 'examples', 'outbound-personalization-input.example.yaml'), '--sample-run', 'outbound-personalization.yaml', '--json'],
  },
];

for (const check of generatedChecks) {
  const raw = execFileSync(process.execPath, check.args, { encoding: 'utf8' });
  assertNoForbidden(raw, check.label, [...clayIdPatterns, ...secretPatterns, ...generatedArtifactExtraPatterns]);
}

console.log(JSON.stringify({ ok: true, checked: scanned, generated: generatedChecks.length, mode: 'whole-tree' }, null, 2));

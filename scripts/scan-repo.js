#!/usr/bin/env node
/**
 * scan-repo.js - repo-wide safety scanner. Runs in CI on every push/PR and
 * locally via `npm run scan`. Zero findings required to merge.
 *
 * What it catches (shape-based, so it protects every contributor):
 *   - real Clay resource IDs           (t|wb|gv|f|aa)_0xxxxxxxxxx  - placeholders like t_TEST_* pass
 *   - known secret formats             sk-..., xox?-, ghp_/gh?_, AKIA..., eyJ... JWTs, PEM blocks
 *   - webhook URLs that act as keys    hooks.slack.com/..., api.clay.com/v3/sources/webhook/...
 *   - credentials in query strings     ?api_key=..., ?token=..., etc.
 *   - email addresses                  none belong in templates or code
 *   - high-entropy string literals     random-looking tokens >= 24 chars
 *   - risky file types                 csv/xlsx/har/sqlite/screenshots anywhere, and anything
 *                                      but yaml/md inside community/
 *
 * Exit 0 = clean. Exit 1 = findings printed with fix hints.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const SKIP_DIRS = new Set(['node_modules', '.git', 'runs', 'exports', 'tmp']);
const RISKY_EXT = new Set(['.csv', '.tsv', '.xlsx', '.xls', '.har', '.db', '.sqlite', '.sqlite3', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.pem', '.p12', '.pfx']);
const COMMUNITY_ALLOWED_EXT = new Set(['.yaml', '.yml', '.md', '.json']);

const RULES = [
  { id: 'clay-real-id', re: /\b(t|wb|gv|f|aa|s)_0[A-Za-z0-9]{10,}\b/g, hint: 'Replace with a placeholder like t_TEST_TABLE or a {{variable}} - real Clay IDs never ship.' },
  { id: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, hint: 'Remove the key and rotate it NOW - a pushed key is compromised even if you delete it.' },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, hint: 'Remove and rotate the Slack token immediately.' },
  { id: 'github-token', re: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, hint: 'Remove and rotate the GitHub token immediately.' },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g, hint: 'Remove and rotate the AWS key immediately.' },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, hint: 'JWTs are credentials - remove and invalidate the session.' },
  { id: 'pem-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, hint: 'Private keys never ship - remove and rotate.' },
  { id: 'slack-webhook', re: /hooks\.slack\.com\/(services|triggers)\/[A-Za-z0-9/]+/g, hint: 'Slack webhook URLs are secrets - remove and regenerate the webhook.' },
  { id: 'clay-webhook', re: /api\.clay\.com\/v3\/sources\/webhook\/[A-Za-z0-9-]+/g, hint: 'Clay webhook source URLs accept data from anyone who has them - remove and recreate the source.' },
  { id: 'cred-in-url', re: /[?&](api[_-]?key|apikey|token|secret|password|client_secret|access_token|signature)=[A-Za-z0-9._%-]{8,}/gi, hint: 'Credential in a URL query string - remove it and rotate.' },
  { id: 'email-address', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, hint: 'Real email addresses do not belong in a shared template - use {{email}} or example@example.com.', allow: /@example\.(com|org)|@your-?domain|@company\.com\b|@users\.noreply\.github\.com/i },
];

// Files whose PURPOSE is containing fake secret-shaped values (they test the
// redaction engine). Secret-format/webhook/entropy rules are skipped for them,
// but the clay-real-id rule still applies - a real ID has no business even here.
const REDACTION_FIXTURES = new Set(['test-redaction.js', path.join('test', 'redaction-input.json'), 'test-proof-packet.js']);
// npm lockfiles are all integrity hashes - entropy scanning them is pure noise
// (gitleaks still covers them with lockfile-aware rules).
const ENTROPY_EXEMPT = new Set(['package-lock.json']);

// Long random-looking literal detector: base64/hex-ish runs with mixed classes.
const ENTROPY_RE = /['"`]([A-Za-z0-9+/=_-]{28,})['"`]/g;
function looksRandom(s) {
  if (/^(https?:|\.\/|\/|[A-Z_]+$|[a-z-]+$)/.test(s)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter(re => re.test(s)).length;
  if (classes < 3) return false;
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  const entropy = -Object.values(freq).reduce((acc, n) => { const p = n / s.length; return acc + p * Math.log2(p); }, 0);
  return entropy > 4.2;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile()) yield path.join(dir, entry.name);
  }
}

function main() {
  const findings = [];
  let fileCount = 0;

  for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file);
    const ext = path.extname(file).toLowerCase();

    if (RISKY_EXT.has(ext)) {
      findings.push({ rule: 'risky-file-type', file: rel, line: 0, hint: `${ext} files can carry contact data or captures - they are not allowed in this repo.` });
      continue;
    }
    if (rel.startsWith('community' + path.sep) && !rel.includes(path.sep + 'schemas' + path.sep) && !COMMUNITY_ALLOWED_EXT.has(ext)) {
      findings.push({ rule: 'community-file-type', file: rel, line: 0, hint: 'Only .yaml and .md files are allowed in community/ contributions.' });
      continue;
    }

    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    fileCount++;
    const lines = text.split('\n');
    const selfExempt = rel === path.join('scripts', 'scan-repo.js'); // this file names the patterns it hunts

    const fixtureExempt = REDACTION_FIXTURES.has(rel);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const rule of RULES) {
        if (selfExempt) continue;
        if (fixtureExempt && rule.id !== 'clay-real-id') continue;
        rule.re.lastIndex = 0;
        const m = rule.re.exec(line);
        if (m && !(rule.allow && rule.allow.test(m[0]))) {
          findings.push({ rule: rule.id, file: rel, line: i + 1, match: m[0].slice(0, 8) + '...', hint: rule.hint });
        }
      }
      if (!selfExempt && !fixtureExempt && !ENTROPY_EXEMPT.has(rel)) {
        ENTROPY_RE.lastIndex = 0;
        let em;
        while ((em = ENTROPY_RE.exec(line)) !== null) {
          if (looksRandom(em[1])) {
            findings.push({ rule: 'high-entropy-literal', file: rel, line: i + 1, match: em[1].slice(0, 8) + '...', hint: 'This looks like a random token/key. If it is one: remove it and ROTATE it. If it is not, add context or restructure so it does not look like a secret.' });
          }
        }
      }
    }
  }

  if (findings.length) {
    console.error(`\n[FAIL] ${findings.length} safety finding(s) across ${fileCount} scanned files:\n`);
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  [${f.rule}]${f.match ? ' ' + f.match : ''}`);
      console.error(`      fix: ${f.hint}\n`);
    }
    console.error('Nothing was published - fix the findings above and push again.');
    console.error('If a real secret was already pushed in ANY commit: rotate it first. See SECURITY.md.');
    process.exit(1);
  }
  console.log(`[OK] ${fileCount} files scanned - no unsafe patterns found.`);
}

main();

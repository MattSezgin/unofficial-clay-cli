#!/usr/bin/env node
/**
 * generate-leaderboard.js - tallies template votes and regenerates:
 *   1. the Top Workflows leaderboard in README.md (between LEADERBOARD markers)
 *   2. every contributor profile page (community/contributors/<handle>/README.md)
 *
 * A vote = a thumbs-up reaction on the template's discussion thread
 * (created automatically per template, titled "[template] <id>").
 *
 * Runs in GitHub Actions on a schedule; also runnable locally:
 *   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/generate-leaderboard.js
 * Without a token it regenerates pages with zero votes (useful for previews).
 */
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'community', 'templates');
const CONTRIBUTORS_DIR = path.join(ROOT, 'community', 'contributors');
const README = path.join(ROOT, 'README.md');
const START = '<!-- LEADERBOARD:START -->';
const END = '<!-- LEADERBOARD:END -->';
const TOP_N = 10;

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('_')).map(e => e.name);
}
function loadYaml(file) { return YAML.parse(fs.readFileSync(file, 'utf8')); }

async function fetchVotes() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const votes = new Map();
  if (!token || !repo) {
    console.log('[INFO] no GITHUB_TOKEN/GITHUB_REPOSITORY - rendering with zero votes');
    return votes;
  }
  const [owner, name] = repo.split('/');
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const query = `query($owner:String!,$name:String!,$cursor:String){
      repository(owner:$owner,name:$name){
        discussions(first:100,after:$cursor){
          pageInfo{hasNextPage endCursor}
          nodes{ title url reactions(content:THUMBS_UP){totalCount} }
        }
      }}`;
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { owner, name, cursor } }),
    });
    if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}: ${await res.text()}`);
    const body = await res.json();
    if (body.errors) throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
    const conn = body.data.repository.discussions;
    for (const d of conn.nodes) {
      const m = /^\[template\]\s+([a-z0-9-]+)$/.exec(d.title || '');
      if (m) votes.set(m[1], { count: d.reactions.totalCount, url: d.url });
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return votes;
}

function loadTemplates(votes) {
  return listDirs(TEMPLATES_DIR).map(slug => {
    const t = loadYaml(path.join(TEMPLATES_DIR, slug, 'template.yaml'));
    const vote = votes.get(slug) || { count: 0, url: null };
    return { slug, title: t.title, author: t.author, category: t.category, votes: vote.count, discussionUrl: vote.url, spec: t };
  }).sort((a, b) => b.votes - a.votes || a.title.localeCompare(b.title));
}

function loadProfiles() {
  const profiles = new Map();
  for (const handle of listDirs(CONTRIBUTORS_DIR)) {
    try { profiles.set(handle, loadYaml(path.join(CONTRIBUTORS_DIR, handle, 'profile.yaml'))); } catch { /* validated elsewhere */ }
  }
  return profiles;
}

function authorLabel(handle, profiles) {
  if (handle === 'anonymous') return 'anonymous';
  const p = profiles.get(handle);
  if (!p) return `@${handle}`;
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
  const who = p.role && p.company ? `${p.role} at ${p.company}` : p.company || p.role || '';
  return `[${name}](community/contributors/${handle}/)${who ? `, ${who}` : ''}`;
}

function renderLeaderboard(templates, profiles) {
  if (!templates.length) {
    return `${START}\n*No community workflows yet - [share the first one](CONTRIBUTING.md) and this board is yours.*\n${END}`;
  }
  const rows = templates.slice(0, TOP_N).map((t, i) => {
    const voteCell = t.discussionUrl ? `[${t.votes} votes](${t.discussionUrl})` : `${t.votes} votes`;
    return `| ${i + 1} | [${t.title}](community/templates/${t.slug}/) | \`${t.category}\` | ${authorLabel(t.author, profiles)} | ${voteCell} |`;
  });
  return [
    START,
    '| # | Workflow | Category | Author | Votes |',
    '|---|----------|----------|--------|-------|',
    ...rows,
    '',
    `*Vote with a thumbs-up on a workflow's discussion thread. Updated automatically.*`,
    END,
  ].join('\n');
}

function renderProfile(handle, profile, templates) {
  const mine = templates.filter(t => t.author === handle);
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
  const who = [profile.role, profile.company].filter(Boolean).join(' at ');
  const totalVotes = mine.reduce((sum, t) => sum + t.votes, 0);
  const links = [
    profile.linkedin ? `[**LinkedIn**](${profile.linkedin})` : null,
    `[**GitHub**](https://github.com/${handle})`,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  const lines = [
    '<div align="center">',
    '',
    `<img src="https://github.com/${handle}.png" width="110" alt="${name}">`,
    '',
    `# ${name}`,
    '',
  ];
  if (who) lines.push(`**${who}**`, '');
  lines.push(
    links,
    '',
    `![workflows](https://img.shields.io/badge/workflows-${mine.length}-8b5cf6) ![total votes](https://img.shields.io/badge/total_votes-${totalVotes}-0ea5e9)`,
    ''
  );
  if (profile.tagline) lines.push(`> *${profile.tagline}*`, '');
  lines.push('</div>', '', '## Workflows', '');

  if (!mine.length) {
    lines.push('*Nothing shared yet - [the wizard makes it a 5-minute job](../../../CONTRIBUTING.md).*');
  } else {
    lines.push('| Workflow | Category | Votes |', '|----------|----------|-------|');
    for (const t of mine) {
      const voteText = t.discussionUrl ? `[${t.votes}](${t.discussionUrl})` : `${t.votes}`;
      lines.push(`| [**${t.title}**](../../templates/${t.slug}/) | \`${t.category}\` | ${voteText} |`);
    }
  }
  lines.push('', '---', '', '*Generated from `profile.yaml` - edit that file, not this page. Want your own profile? [Share a workflow](../../../CONTRIBUTING.md).*', '');
  return lines.join('\n');
}

function renderTemplatePage(t, profiles) {
  const spec = t.spec;
  const voteText = t.discussionUrl ? `[**${t.votes} votes**](${t.discussionUrl}) - add yours with a thumbs-up` : 'Voting thread appears after merge';
  const lines = [
    '<div align="center">',
    '',
    `# ${t.title}`,
    '',
    `\`${t.category}\` &nbsp;·&nbsp; by ${authorLabel(t.author, profiles).replace('community/contributors/', '../../contributors/')} &nbsp;·&nbsp; ${voteText}`,
    '',
    '</div>',
    '',
    `> ${String(spec.description || '').trim()}`,
    '',
  ];
  if (spec.credits_note) lines.push(`**Cost:** ${spec.credits_note}`, '');
  lines.push('## What your table needs', '', '| Input column | Type | Required | Example |', '|--------------|------|----------|---------|');
  for (const input of spec.inputs || []) {
    lines.push(`| \`${input.name}\` | ${input.type} | ${input.required ? 'yes' : 'no'} | ${input.example ? `\`${input.example}\`` : ''} |`);
  }
  lines.push('', '## The steps', '', '| # | Column | Kind | Notes |', '|---|--------|------|-------|');
  (spec.steps || []).forEach((step, i) => {
    const kind = step.kind === 'action' && step.action_key ? `\`${step.action_key}\`` : `\`${step.kind}\``;
    const notes = [step.run_condition_note, step.notes].filter(Boolean).join(' ');
    lines.push(`| ${i + 1} | **${step.field}** | ${kind} | ${notes} |`);
  });
  if (spec.first_run) {
    lines.push('', '## Before you scale', '', `Run **${spec.first_run.sample_rows || 10} rows first** and check:`, '');
    for (const check of spec.first_run.quality_checks || []) lines.push(`- ${check}`);
  }
  lines.push('', '---', '', '*The machine-readable version is [`template.yaml`](template.yaml) - this page is generated from it. Build something better? [Share it](../../../CONTRIBUTING.md).*', '');
  return lines.join('\n');
}

async function main() {
  const votes = await fetchVotes();
  const templates = loadTemplates(votes);
  const profiles = loadProfiles();

  if (fs.existsSync(README)) {
    const readme = fs.readFileSync(README, 'utf8');
    if (readme.includes(START) && readme.includes(END)) {
      const next = readme.slice(0, readme.indexOf(START)) + renderLeaderboard(templates, profiles) + readme.slice(readme.indexOf(END) + END.length);
      fs.writeFileSync(README, next);
      console.log('[OK] README leaderboard updated');
    } else {
      console.log('[WARN] README has no LEADERBOARD markers - skipped');
    }
  }

  for (const [handle, profile] of profiles) {
    fs.writeFileSync(path.join(CONTRIBUTORS_DIR, handle, 'README.md'), renderProfile(handle, profile, templates));
  }
  for (const t of templates) {
    fs.writeFileSync(path.join(TEMPLATES_DIR, t.slug, 'README.md'), renderTemplatePage(t, profiles));
  }
  console.log(`[OK] ${profiles.size} profile page(s) + ${templates.length} template page(s) regenerated`);
}

main().catch(err => { console.error(`[FAIL] ${err.message}`); process.exit(1); });

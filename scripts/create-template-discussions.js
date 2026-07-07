#!/usr/bin/env node
/**
 * create-template-discussions.js - ensures every community template has its
 * voting thread: a discussion titled "[template] <id>" in the Show and tell
 * category. Idempotent - safe to run on every push.
 *
 * Env: GITHUB_TOKEN (needs discussions:write), GITHUB_REPOSITORY (owner/repo)
 */
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'community', 'templates');
const CATEGORY_NAME = 'Show and tell';

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  return body.data;
}

async function main() {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
    throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
  }
  const [owner, name] = process.env.GITHUB_REPOSITORY.split('/');

  const slugs = fs.existsSync(TEMPLATES_DIR)
    ? fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('_')).map(e => e.name)
    : [];
  if (!slugs.length) { console.log('[OK] no templates yet'); return; }

  const repoData = await gql(
    `query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        id
        discussionCategories(first:25){ nodes{ id name } }
        discussions(first:100){ nodes{ title } }
      }}`,
    { owner, name }
  );
  const repoId = repoData.repository.id;
  const category = repoData.repository.discussionCategories.nodes.find(c => c.name === CATEGORY_NAME);
  if (!category) throw new Error(`Discussion category '${CATEGORY_NAME}' not found - enable Discussions and keep the default categories`);
  const existing = new Set(repoData.repository.discussions.nodes.map(d => d.title));

  let created = 0;
  for (const slug of slugs) {
    const title = `[template] ${slug}`;
    if (existing.has(title)) continue;
    const template = YAML.parse(fs.readFileSync(path.join(TEMPLATES_DIR, slug, 'template.yaml'), 'utf8'));
    const body = [
      `**${template.title}** - vote for this workflow with a thumbs-up reaction on this post.`,
      '',
      template.description || '',
      '',
      `Template: https://github.com/${owner}/${name}/tree/main/community/templates/${slug}`,
      '',
      '_Questions and improvement ideas welcome below._',
    ].join('\n');
    await gql(
      `mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){
        createDiscussion(input:{repositoryId:$repoId,categoryId:$catId,title:$title,body:$body}){ discussion{ url } }
      }`,
      { repoId, catId: category.id, title, body }
    );
    created++;
    console.log(`[OK] created voting thread: ${title}`);
  }
  console.log(`[OK] done - ${created} new thread(s), ${slugs.length - created} already existed`);
}

main().catch(err => { console.error(`[FAIL] ${err.message}`); process.exit(1); });

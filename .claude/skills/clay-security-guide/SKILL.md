---
name: clay-security-guide
description: Understand what actually leaks Clay secrets and client data, and how this repo's scanner catches it - use when reviewing what's safe to commit or share, explaining why something got flagged, or responding to a pushed secret.
---

# clay-security-guide

This is a teaching skill: it explains *why* the repo is shaped the way it is, so you
can reason about a new situation instead of just following a checklist. Everything
here can be explained fully to anyone who asks - there is nothing in this workflow
that needs to be hidden from the person you're helping.

## The five ways Clay secrets and client data actually leak

1. **API keys inside Clay HTTP columns.** A Clay "HTTP API" column often has a key
   sitting in a header or the URL itself. If you export that table or screenshot it,
   the key travels with it. This is why `/clay-share-workflow`'s wizard never copies
   column config - it rebuilds a clean template and forces every HTTP step down to a
   `{{PLACEHOLDER}}`, structurally, so there's nothing to accidentally leave in.

2. **Webhook URLs are passwords.** A Clay webhook source URL (or a Slack webhook)
   accepts data from anyone who has the URL - there's no separate auth on top of it.
   Treat one exactly like a credential: never paste it in a public issue, PR
   description, or chat channel that isn't access-controlled.

3. **Table exports carry people.** A CSV (or JSON dump) of a Clay table is contact
   data - emails, phones, LinkedIn URLs, whatever you enriched. It never belongs in a
   public repo. This is a hard rule, not a judgment call: `scripts/scan-repo.js` blocks
   `.csv`/`.xlsx`/`.har`/screenshot file types anywhere in the tree, full stop.

4. **Real resource IDs map your business.** Workspace, table, workbook, view, and
   field IDs (`t_`, `wb_`, `gv_`, `f_`, `aa_`, `s_` prefixes followed by a long token)
   look harmless but tie public content back to a private workspace - and can be used
   to probe it. Use placeholders like `t_TEST_TABLE` or `{{table_reference}}`
   everywhere in shared content.

5. **Prompts remember clients.** `use-ai` column prompts often accumulate company
   names, campaign context, or pasted example rows over time as you iterate on them.
   No regex catches all of this reliably - reread every prompt yourself before sharing,
   even after the wizard's automated scrub.

## How the repo protects you

- **Sharing is a form, not a paste box.** `community/templates/*/template.yaml` files
  validate against `community/schemas/template.schema.json`, which is strict by
  design: `additionalProperties: false` everywhere, and the one field that could hold
  a binding value (`inputs_binding`) is pattern-constrained to `{{template_var}}`,
  `${ENV_PLACEHOLDER}`, or a short plain literal - a URL, a colon, a slash, or a long
  token cannot structurally fit there. There's simply no field a raw export or an API
  key can go into.
- **`scripts/scan-repo.js` runs on every push and PR.** It's shape-based, not a
  denylist of specific past leaks, so it protects against secrets it's never seen
  before: real Clay resource IDs, known key formats (`sk-...`, `xox[baprs]-...`,
  `ghp_.../gh?_...`, `AKIA...`, JWT `eyJ...` tokens, PEM blocks), webhook URLs
  (`hooks.slack.com/...`, `api.clay.com/v3/sources/webhook/...`), credentials in query
  strings (`?api_key=`, `?token=`, etc.), email addresses, high-entropy string
  literals (mixed-case/digit runs that read as random), and risky file types. Exit 0
  means clean; exit 1 prints every finding with a fix hint. Run it yourself any time:
  ```bash
  node scripts/scan-repo.js
  ```
- **`scripts/validate-community.js`** checks every template/profile against its JSON
  schema, confirms the folder name matches the template `id` / contributor handle, and
  confirms any `action_key` step references a real key from
  `integration-library/registry.yaml`.
- **gitleaks** runs as a second, independent scanner over the full git history (not
  just the current diff), and **GitHub secret scanning + push protection** are enabled
  on the repository as a third layer.
- **Nothing real is committed by default.** Live run artifacts (`runs/`, `exports/`)
  are git-ignored for everyone, and your session file (`.clay-session`) lives outside
  the repo folder entirely (see `/clay-onboarding`) - it's git-ignored anyway, but it's
  also just never inside the tree to begin with.

## If a secret gets pushed anyway

**Rotate first. Deleting the commit is not enough** - once something reaches GitHub it
can be cached, forked, or already scraped, even if you force-push it away seconds
later.

1. Rotate/revoke the credential immediately: regenerate the API key, recreate the
   webhook, invalidate the session.
2. Then clean the history (rewrite and force-push, or delete the branch) so it stops
   spreading further.
3. If someone else's data was involved, tell them.
4. Open a private security report on the repository (Security tab -> Report a
   vulnerability) so exposure can be checked. Do not open a public issue for an
   unfixed leak.

## Where this shows up day to day

- Before running `node scripts/contribute.js` (`/clay-share-workflow`), read its
  preview like a stranger would - it's the same "reread everything" instinct as
  point 5 above, just applied at the moment you're about to publish.
- Before exporting anything (`/clay-export`), remember exports are contact data by
  default - keep them in ignored directories and redact before sharing a summary.
- If `scan-repo.js` flags something you're confident is a false positive (e.g. a
  long literal that just happens to look random), the fix is to restructure the line
  so it doesn't read as a secret-shaped string - not to bypass or disable the check.

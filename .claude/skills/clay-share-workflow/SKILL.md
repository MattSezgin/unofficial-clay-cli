---
name: clay-share-workflow
description: Share a Clay workflow you built as a community template - use when a user wants to publish a table/spec they built as a reusable template, or asks how to contribute to community/templates.
---

# clay-share-workflow

Sharing is a guided wizard, not a copy-paste. It **rebuilds** a clean template from
your workflow's structure and logic - it never copies raw column config, which is
where API keys and client data hide in a real Clay table.

## Run the wizard

```bash
node scripts/contribute.js
```

This is also wired into `package.json`, so it's runnable as `npm run share`.

Two modes:

```bash
node scripts/contribute.js                          # guided from scratch, Q&A in the terminal
node scripts/contribute.js --from my-spec.yaml       # rebuild from an export-spec file
```

Use `--from` if you already have a spec from `node clay-v2.js export-spec ...`
(`/clay-build-table`) - the wizard reconstructs steps and input variables from it
automatically instead of asking you to describe each column by hand.

## The rebuild-not-copy principle

The wizard never touches your live table config directly. For each field it sees, it
classifies the field kind (`action` / `formula` / `use-ai` / `http-placeholder`) and
rebuilds only the parts safe to share:

- Any input binding value shaped like a real Clay ID, a URL, a path, an email, or a
  known key format (or just long) is automatically replaced with a `{{placeholder}}`.
- `use-ai` prompts get real IDs, emails, and URLs inside the prompt text swapped for
  `{{table_reference}}` / `{{email}}` / `{{url}}` - but the wizard prints a note asking
  you to reread each prompt anyway, since prompts remember company names in ways no
  regex catches.
- `http-placeholder` steps are stripped to nothing but a note: configure your own
  endpoint, keep credentials in env vars, never in the column.

This is why the output is a **template**, structurally incapable of holding the things
that leak (see `community/schemas/template.schema.json` - there's no field a raw
export or a long token can even go into).

## The preview step

Before anything is written to disk, the wizard prints the exact
`community/templates/<id>/template.yaml` (and, if you opted into a contributor
profile, `community/contributors/<handle>/profile.yaml`) it's about to create, and
asks:

> Read the preview like a stranger would. Company names in prompts? Real IDs?
> Anything you would not put on a billboard?

Read it that carefully before answering `y`. If anything looks off, answer `n` (or
just don't type `y`) - nothing is written, and you can delete the template's `id`
folder and start over.

**Optional nicer preview:** if `npx -y lavish-axi` is available in your environment,
you can render this preview as an HTML page for easier review instead of reading raw
terminal YAML - plain terminal preview is the default and always works, so treat this
as a convenience, not a requirement.

## The profile opt-in question

The wizard asks once: "Create a public profile? [Y/n]" - a public page with your name,
company, and LinkedIn that your templates link to and that ranks you on the front-page
leaderboard by vote totals. It is entirely optional: answer `n` and your template ships
with `author: anonymous`. If you opt in, only a GitHub handle and first name are
required; company, role, last name, and LinkedIn are all optional.

## What happens after you approve

1. The wizard writes `community/templates/<id>/template.yaml` (and the profile file,
   if any).
2. It immediately runs the same two gates CI will run on your PR:
   ```bash
   node scripts/scan-repo.js
   node scripts/validate-community.js
   ```
   If either fails, fix the findings (or delete the template's `id` folder to start
   over) - nothing partial gets left in a broken state for you to accidentally commit.
3. On success it prints the exact publish steps:
   ```bash
   git checkout -b share/<id>
   git add community/templates/<id>/ community/contributors/<handle>/
   git commit -m "template: <title>"
   git push and open a pull request
   ```
4. After merge, your template gets a voting thread automatically - the same checks run
   again on the PR, so a template that passed locally will also pass in CI.

## Gotchas

- Template ids are kebab-case, 3-60 chars, and must be unique - the wizard checks for
  an existing folder with the same id before asking anything else.
- `--from` only works against a spec file (`export-spec` output), not a live table ID
  - export first with `/clay-build-table`, then share.
- A template needs at least one step; the wizard refuses to write an empty one.

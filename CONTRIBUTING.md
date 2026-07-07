# Contributing

Two ways to contribute: **share a workflow template** (the fun one) or improve the code.

## Share a workflow (~5 minutes)

You built something in Clay that works - a waterfall, a scoring table, a qualification flow. Here is how it becomes a community template with your name on it:

```bash
npm run share
# or rebuild from a spec you exported with clay-v2:
npm run share -- --from my-exported-spec.yaml
```

The wizard:

1. **Asks what it does** - title, category, a description a stranger can act on.
2. **Rebuilds your workflow as a clean template.** It never copies raw column config (that is where API keys and client data hide). Anything shaped like a real ID, key, URL, or email automatically becomes a `{{placeholder}}`.
3. **Offers you a contributor profile** - name, company, LinkedIn. Your profile becomes a page, your templates link to it, and votes rank you on the front page. Say no and publish anonymously; both are welcome.
4. **Shows you a full preview** - exactly the text that would be published, nothing else. Read it like a stranger would.
5. **Runs the safety scanner + schema validator** locally. The same checks run on your PR, so if it passes here, it merges clean.
6. **Prints the git commands** to open the pull request.

After your PR merges, a voting thread is created automatically. Share the link - every thumbs-up moves your workflow up the leaderboard, which links to your profile.

### What makes a good template

- It solved a real problem for you - proven beats clever
- Honest `credits_note` (nobody likes surprise spend)
- `first_run` quality checks a stranger can actually perform
- Notes on run conditions so waterfalls cascade correctly

### What can never be in a template

Real table/workspace/account IDs, API keys, webhook URLs, email addresses, exported rows, screenshots, client or company-specific context. The schema makes most of this structurally impossible and CI blocks the rest - see [SECURITY.md](SECURITY.md) for why each one matters. If the scanner flags something of yours that already reached a public branch, **rotate the credential first**, then fix the branch.

## Improve the code

- `npm run test:all` must pass (it is fully offline - no Clay account needed)
- `node scripts/scan-repo.js` must report zero findings
- New commands need: real handler + help entry + a test + (if user-facing) a skill/doc mention. Never document a command that does not exist.
- Mutating commands must honor the `--dry-run` / `--confirm` convention and the write-scope guards

## Ground rules

Be generous with credit, honest about what you tested, and assume contributors of every skill level read what you write. Security reports go through GitHub's private vulnerability reporting, not public issues.

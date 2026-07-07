# Security

This project moves real Clay workflows between real workspaces, so security is designed in, not bolted on. This page covers (1) how the repo protects you, (2) the mistakes that actually leak secrets in the Clay world, and (3) what to do if something slips.

## How this repo protects you

- **Sharing is a form, not a paste box.** Community templates are strict YAML validated against a schema (`community/schemas/`). There is no field where a raw table export, screenshot, or column config blob can go, and binding values structurally cannot hold URLs or long tokens - the places API keys usually hide.
- **A shape scanner runs on every push and PR** (`scripts/scan-repo.js`): real Clay resource IDs, known key formats, webhook URLs, credentials in query strings, email addresses, random-looking tokens, and risky file types (.csv, .har, screenshots) all fail the build. Placeholders like `t_TEST_TABLE` and `{{variables}}` pass.
- **gitleaks** runs as a second, independent scanner over the full git history.
- **GitHub secret scanning + push protection** are enabled on this repository.
- **Nothing real is ever committed by default.** The CLI writes all live run artifacts to `runs/` and `exports/`, which are git-ignored for everyone. Your session file (`.clay-session`) lives OUTSIDE the repo folder and is git-ignored anyway.

## The mistakes that actually leak (learn these)

1. **API keys inside Clay HTTP columns.** A Clay "HTTP API" column often has a key sitting in a header or URL. If you export or screenshot that table, the key goes with it. The share wizard never copies column config - it rebuilds a clean template and forces `${PLACEHOLDER}` values.
2. **Webhook URLs are passwords.** A Clay webhook source URL or a Slack webhook accepts data from ANYONE who has it. Treat them like credentials.
3. **Table exports carry people.** A CSV of a Clay table is contact data (emails, phones, LinkedIn URLs). It never belongs in a public repo - the scanner blocks the file types outright.
4. **Real resource IDs map your business.** Workspace/table/account IDs look harmless but tie public content to your private workspace. The scanner bans their shape entirely - use placeholders.
5. **Prompts remember clients.** AI-column prompts often contain company names, campaign context, or pasted example rows. Reread every prompt before sharing; the wizard shows you a full preview.

## If a secret was pushed anyway

**Rotate first. Deleting is not enough.** Once a commit reaches GitHub it may be cached, forked, or already scraped - even if you force-push it away seconds later.

1. Rotate/revoke the credential NOW (regenerate the API key, recreate the webhook, invalidate the session).
2. Then clean the history (rewrite/force-push or delete the branch) so it stops spreading.
3. If it involved someone else's data, tell them.
4. Open a security report here so we can help check exposure.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository (Security tab -> Report a vulnerability). Report privately first - do not open a public issue for an unfixed leak or vulnerability.

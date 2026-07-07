---
name: clay-onboarding
description: Set up auth, session, and profile config for clay-cli before running any command - use when a Clay command fails with "session expired", when starting fresh in a new checkout, or when configuring workspace/folder/workbook IDs for the first time.
---

# clay-onboarding

Everything in this package that talks to Clay (every command except the offline ones
listed below) needs a valid session. This skill gets you from a fresh checkout to a
working session and a validated runtime profile.

## The session file - read this first

- Session lives in **`.clay-session`**, a JSON file: `{"cookie": "<claysession value>", "savedAt": "<ISO date>"}`.
- CRITICAL: it lives **one directory above** the clay-cli package (`../.clay-session`
  relative to the package root), not inside it - a credential outside the working tree can never be committed. `.env` goes in the REPO ROOT (`cp .env.example .env`); one directory above also works. Create both
  one level above wherever you cloned this repo.
- TTL is **23 hours**. Older sessions are treated as absent and a new login/cookie is
  required.
- On a 401 the session is **not deleted** - it is renamed to `.clay-session.invalid` so
  you can inspect it. Delete that file (or just re-auth) to recover; the next run
  re-logs in from `.env` if present.

## Option A - auto-refresh via .env (recommended)

Create `.env` in the repo root (gitignored; `cp .env.example .env`) with:

```
CLAY_EMAIL=you@example.com
CLAY_PASSWORD=your-password
```

The first command you run will detect no valid session, log in, extract the
`claysession` cookie from the response, and write `../.clay-session` automatically.
`.env` parsing strips quotes and comments, so `CLAY_EMAIL="you@example.com"` also works.

This is Clay's internal v3 web API accessed via a session cookie, not a published
public API key - treat the password in `.env` as a real credential (plaintext on disk,
never committed).

## Option B - manual cookie (no .env)

1. Log into `app.clay.com` in your browser.
2. Open DevTools -> **Application tab** -> Cookies -> `app.clay.com` -> copy the value
   of the `claysession` cookie. Do not paste anything into the console; you only need
   the cookie value.
3. Write it to `../.clay-session`:
   ```json
   {"cookie": "PASTE_THE_CLAYSESSION_VALUE_HERE", "savedAt": "2026-01-01T00:00:00.000Z"}
   ```
   If you run a command without a session file, the error message prints this exact
   one-liner for you to copy.

## Runtime profile (workspace / folder / workbook)

Copy the template and fill in your own IDs:

```bash
cp config.example.yaml config.local.yaml
```

`config.local.yaml` is gitignored. Profile values resolve from `${ENV_VAR}`
placeholders in the file or from real environment variables. Validate before relying
on it:

```bash
node validate-config.js config.local.yaml --profile default
```

To inspect a profile without ever printing raw IDs (env presence + redacted values
only):

```bash
node profile-context.js config.local.yaml --profile default
```

## Write scopes are env-driven - know this before you try to write

`clay-v2.js` restricts every mutating command to an allowlist built at startup from
your environment: set `CLAY_WORKSPACE_ID` (and optionally `CLAY_FOLDER_ID` to scope
writes to one sandbox folder), or set `CLAY_WRITE_SCOPES` to a JSON array of
`{"name","workspaceId","folderId"}` objects if you need multiple named scopes. A fresh
clone can write to your own Clay workspace as soon as those env vars are set - no
source edits required, ever. Read-only commands (see `/clay-explore`) work immediately
with just a session; writes need those env vars plus `--confirm` on every mutating call.

`node clay-v2.js dev-mode` prints the current scoped dev-mode contract (which
workspace/folder dev-mode is scoped to, and what it auto-approves) so you can see
exactly what you're editing.

## Offline commands (no session needed)

`redact`, `score`, `validate-spec`, `integration-list`, `integration-show`,
`integration-validate-spec`, `integration-promotion-report`,
`normalize-actions-catalog`, `catalog-delta`; also `apply-spec` / `create-field` /
`update-field` / `create-action` with `--dry-run`, and `verify-field-output-schema` /
`proof-readback` with `--from-manifest`. Use these to explore the CLI's shape before
you've set up any auth at all.

## Gotchas

- All output is redacted by default (real IDs/secrets become `<redacted:...>` stubs).
  Use `--raw` only when you specifically need unredacted output, and never paste
  `--raw` output anywhere public. `--report file` writes a redaction report
  (paths/counts only, still safe to share).
- If you see "session expired or invalid" mid-session, that's the renamed
  `.clay-session.invalid` file - delete it and rerun to trigger a fresh login.

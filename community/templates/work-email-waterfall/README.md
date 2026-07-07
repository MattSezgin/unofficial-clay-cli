<div align="center">

# Work Email Waterfall

`enrichment` &nbsp;·&nbsp; by [Matt Sezgin](../../contributors/MattSezgin/) &nbsp;·&nbsp; Voting thread appears after merge

</div>

> Find a work email for a person when you know their name and company domain, by trying providers in cost order and validating the winner. Each provider step only runs if the previous ones came up empty, so you never pay twice for the same row.

**Cost:** Usually 1-3 credits per row - later steps only fire on rows the earlier providers missed.

## What your table needs

| Input column | Type | Required | Example |
|--------------|------|----------|---------|
| `first_name` | text | yes | `Jane` |
| `last_name` | text | yes | `Doe` |
| `company_domain` | url | yes | `acme.example.com` |

## The steps

| # | Column | Kind | Notes |
|---|--------|------|-------|
| 1 | **Findymail Email** | `findymail-find-work-email` | First provider - best hit rate for the cost in our runs. |
| 2 | **Icypeas Email** | `icypeas-find-email-v2` | Only run if Findymail Email is empty - set the run condition on the column so the waterfall cascades automatically. |
| 3 | **Datagma Email** | `datagma-find-work-email-v3` | Only run if both earlier providers are empty. |
| 4 | **Email Valid** | `validate-email` | Point this at whichever email column filled first; only send rows that validate. |

## Before you scale

Run **10 rows first** and check:

- At least half of the sample rows found an email from the first provider.
- Spot-check 3 found emails against the person's LinkedIn - right person, right company.
- Validation step returns a clear valid/invalid status for every found email.
- No provider ran on rows where an earlier provider already found an email.

---

*The machine-readable version is [`template.yaml`](template.yaml) - this page is generated from it. Build something better? [Share it](../../../CONTRIBUTING.md).*

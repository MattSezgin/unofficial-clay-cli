# Clay Playbook Library

This folder is the portable "skill library" for the Clay CLI. A playbook describes a repeatable Clay workflow, the row inputs it needs, the Clay operations it performs, the first-10 testing loop, and the evidence required before scaling.

Playbooks are intentionally higher-level than raw `specs/*.yaml` files:

- `specs/` describe a Clay table/source/action shape.
- `playbooks/` describe the whole operating loop around that shape.

## Current Playbooks

| Playbook | Purpose |
|---|---|
| `people-from-companies.yaml` | Start with company names/job titles, dedupe companies, find company domains/LinkedIn URLs, then find people by title at those companies. |
| `outbound-personalization.yaml` | Create a first-10-safe AI qualification and personalization workflow for outbound campaigns. |
| `source-to-ready-list.yaml` | Source companies/people, qualify, QA, and produce ready/reject views. |
| `email-phone-waterfall.yaml` | Cascade email/phone providers and produce campaign-ready contact records with QA status. |
| `crm-enrichment-export.yaml` | Enrich CRM exports, preserve IDs, classify rows, and produce import-ready payloads. |
| `webhook-enrichment.yaml` | Build a one-payload-first webhook enrichment table with optional callback. |
| `table-audit-clone.yaml` | Export, redact, verify, clone, and repair-plan an existing table. |
| `campaign-activation-with-status-lookup.yaml` | Check existing campaign status and sendability before adding leads to an outbound campaign (Smartlead/Instantly/etc.). |
| `conference-attendee-identity-enrichment.yaml` | Turn scraped conference attendee rows into verified person/company identities with QA lanes for outreach. |
| `crm-usage-intent.yaml` | Combine job-posting evidence, CRM usage signals, and AI classification to identify accounts likely using or evaluating a target CRM/GTM tool. |
| `founder-contact-waterfall.yaml` | Connect founders to company records, verify LinkedIn profiles, and run a multi-provider work-email waterfall with validation. |
| `lookalike-to-role-based-people-search.yaml` | Source and qualify lookalike companies, then trigger role-based people searches across campaign lanes. |

## Example Inputs

Each playbook has a public-safe example input at:

```text
examples/<playbook-id>-input.example.yaml
```

Example inputs provide column names, brief fields, payload fields, or parameter placeholders. Generated offline plans intentionally show only keys/counts, not example values.

## Required Loop

1. Validate the playbook and any referenced specs offline.
2. Build or import only 5-10 test rows.
3. Read back the table/source state.
4. Run only first 10 or fewer credit-consuming rows.
5. Verify full JSON results, output fields, and QA views.
6. Produce a continue/stop recommendation.
7. Scale only after explicit chat confirmation.

## Public Repo Rule

Do not add private workspace IDs, `claysession` cookies, app account IDs, webhook URLs, or client row data here. Use variables and local profiles.

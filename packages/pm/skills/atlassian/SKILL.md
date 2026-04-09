---
name: atlassian
description: Forgeflow guidance for working with Jira issues and Confluence pages via Atlassian OAuth. Use when a prompt contains Jira keys or URLs, Confluence URLs, asks what a ticket or page says, or needs to decide between /atlassian-read, /investigate, /create-jira-issues, and /implement.
---

# Atlassian

Use this skill whenever the task touches Jira or Confluence.

## What forgeflow can do today

### Read a Jira issue or Confluence page

Use:

```bash
/atlassian-read <jira-or-confluence-url>
```

Examples:

```bash
/atlassian-read https://yourcompany.atlassian.net/browse/PROJ-123
/atlassian-read https://yourcompany.atlassian.net/wiki/spaces/ENG/pages/123456/Design
```

This is the default choice when the user asks things like:

- what does this Jira ticket say?
- summarise this ticket
- read this Confluence page
- what is on this URL?

Rules:

- `/atlassian-read` accepts a **URL**, not a bare Jira key.
- If the user gives only `PROJ-123` and asks what it says, ask for the Jira URL.
- If Atlassian access fails, tell the user to run `/atlassian-login`.

### Implement a Jira-backed ticket

Use:

```bash
/implement PROJ-123
```

Rules:

- `/implement` currently supports a **bare Jira key**.
- Do not assume extra free-text after the key will be interpreted as a Jira URL.
- If the user wants implementation, prefer the Jira key form.

### Investigate using a Confluence template

Use:

```bash
/investigate "topic" --template <confluence-url>
```

Rules:

- The `--template` Confluence URL is fetched before the investigator runs.
- Extra Jira and Confluence URLs mentioned in the investigation description are also auto-fetched as reference material.
- If you want to inspect one of those links directly before the investigation, use `/atlassian-read`.

Recommended flow for extra reference docs:

1. Put the document template page in `--template`.
2. Include any supporting Jira or Confluence URLs in the investigation description.
3. Use `/atlassian-read` only when you want to inspect or summarise a reference separately before starting the investigation.
4. Treat the fetched references as source material, but keep the output structure driven by the template page.

### Create Jira issues from Confluence docs

Use:

```bash
/create-jira-issues <confluence-url> [confluence-url...] [--example <jira-or-confluence-url>]
```

Rules:

- The main inputs are Confluence PM document URLs.
- `--example` can be a Jira ticket URL or Confluence page URL.
- The pipeline fetches those pages before planning the Jira drafts.

## How to respond in normal chat

When the user is chatting normally rather than typing a slash command:

- If they provide a Jira or Confluence **URL** and ask what it says, use `/atlassian-read`.
- If they ask how to implement Jira work, prefer `/implement PROJ-123`.
- If they want a spike or RFC based on a Confluence template, use `/investigate ... --template <url>`.
- If they mention extra Atlassian links for an investigation, read them first with `/atlassian-read` instead of assuming the investigator will fetch them.

## Failure handling

If Atlassian access does not work:

1. Check that the user has run `/atlassian-login`.
2. Check `ATLASSIAN_URL` points at the correct site.
3. If multiple Atlassian sites exist, tell the user to set `ATLASSIAN_URL`.
4. If the user gives a bare Jira key for a read request, ask for the full Jira URL.
5. If Confluence reads fail with scope errors, make sure the Atlassian app and login flow include `read:confluence-content.all`, `read:page:confluence`, `read:content.metadata:confluence`, `read:content-details:confluence`, and `read:space:confluence`, then re-run `/atlassian-login` after deleting `~/.pi/agent/forgeflow-atlassian-oauth.json`.

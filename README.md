# forgeflow

Forgeflow is a pair of [Pi](https://shittycodingagent.ai/) packages that take you from a product idea to merged pull requests.

```text
idea -> /init -> /prd-qa -> /create-gh-issues -> /implement-all
```

Install one package or both:

| Package | Install | Use it for |
|---|---|---|
| `@callumvass/forgeflow-pm` | `pi install npm:@callumvass/forgeflow-pm` | PRDs, issue creation, research, Jira/Confluence planning |
| `@callumvass/forgeflow-dev` | `pi install npm:@callumvass/forgeflow-dev` | TDD implementation, review, architecture, skill discovery |

## Quick start

```bash
pi install npm:@callumvass/forgeflow-pm
pi install npm:@callumvass/forgeflow-dev
cd your-project
```

### Greenfield project

```text
/init
/prd-qa
# final review/edit PRD.md
/create-gh-issues
/implement-all
```

### Existing project

```text
/continue "describe the next phase"
/implement-all
```

## Recommended greenfield workflow

After `/prd-qa`, do one final review of `PRD.md` before creating issues.
A good greenfield PRD should usually include:
- a clear MVP flow
- scope and non-goals
- `## Technical Direction` with the chosen stack/framework/testing/auth/persistence decisions where they materially matter
- `## Alternatives Considered` for major project-shaping choices, kept brief

That gives you a cheap review point before code exists:
- "Use Vue, not React"
- "Use Clerk, not Better Auth"
- "Use ASP.NET Core Identity"
- "Keep this server-rendered for MVP"

`/create-gh-issues` treats the chosen option as binding and alternatives as context only.

## When to use `/investigate`

`/investigate` is optional. It is a general research/spike command, not just a Confluence feature.

Use it when you want deeper research before editing the PRD, for example:

```text
/investigate "Compare suitable auth options for this app"
/investigate "Compare framework/runtime choices for this project"
/investigate "Assess whether the current auth and cookie implementation is safe"
```

Optional template support:

```text
/investigate "Compare auth options" --template <url>
```

If no template is provided, forgeflow uses a default structure.
Confluence templates are supported, but not required.

## Command cheat sheet

### PM package

| Command | What it does |
|---|---|
| `/init` | Draft a first `PRD.md` |
| `/prd-qa` | Refine the PRD until it is implementation-ready |
| `/continue` | Refresh `PRD.md` for the next phase on an existing project |
| `/create-gh-issues` | Turn the PRD into vertical-slice GitHub issues |
| `/create-gh-issue` | Create one GitHub issue from a feature idea |
| `/investigate` | Research a topic and write a spike/RFC markdown doc |
| `/create-jira-issues` | Turn Confluence PM docs into Jira issues |
| `/atlassian-login` | Authenticate to Jira/Confluence |
| `/atlassian-read` | Read a Jira issue or Confluence page by URL |

### Dev package

| Command | What it does |
|---|---|
| `/implement` | Implement one issue using plan → TDD → review |
| `/implement-all` | Implement, review, and merge all open generated issues |
| `/review` | Run structured PR review |
| `/architecture` | Analyse structural friction and create RFC issues |
| `/discover-skills` | Find domain-specific plugins for the current stack |
| `/datadog-login` | Authenticate to an OAuth-enabled Datadog MCP server |
| `/datadog` | Resolve a Lambda from repo code and investigate it through Datadog MCP |

## Requirements

### Core
- Pi CLI installed
- run commands inside your project repo

### GitHub features
For `/create-gh-issues`, `/implement`, `/implement-all`, and `/review`:
- install GitHub CLI
- run `gh auth login`
- use a repo with issues enabled

### Atlassian features
For `/atlassian-login`, `/atlassian-read`, `/create-jira-issues`, optional Confluence-backed `/investigate`, and Jira-backed `/implement PROJ-123`:

```bash
export ATLASSIAN_CLIENT_ID=...
export ATLASSIAN_CLIENT_SECRET=...
export ATLASSIAN_URL=https://yourcompany.atlassian.net
export ATLASSIAN_REDIRECT_URI=http://127.0.0.1:33389/callback
```

Then run:

```text
/atlassian-login
```

Set `ATLASSIAN_JIRA_PROJECT` unless you provide an example Jira ticket URL that lets forgeflow infer the project key.

### Datadog MCP features
For `/datadog-login` and `/datadog`:

```bash
export DATADOG_MCP_URL=https://your-datadog-mcp.example.com/mcp
export DATADOG_MCP_REDIRECT_URI=http://127.0.0.1:33390/callback
```

Then run:

```text
/datadog-login
/datadog "investigate why the billing lambda is slow in prod"
```

The current integration expects a Datadog MCP server that exposes `query-metrics`, `search-logs`, and optionally `search-spans`.

## More detail

- PM package README: `packages/pm/README.md`
- Dev package README: `packages/dev/README.md`

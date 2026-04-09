# @callumvass/forgeflow-dev

Development commands for [Pi](https://shittycodingagent.ai/).
Use this package when you already have implementation-ready issues and want forgeflow to plan, build, review, and open PRs.

## Install

```bash
npx pi install @callumvass/forgeflow-dev
```

## Start here

### Implement one issue

```text
/implement 42
```

### Implement all auto-generated issues

```text
/implement-all
```

This works best after the PM package has already produced good greenfield issues with a clear technical direction — usually one explicit initial scaffold/bootstrap issue followed by dependent feature slices.

## Commands

| Command | What it does |
|---|---|
| `/implement` | Implement one issue using plan → TDD → refactor → review |
| `/implement-all` | Loop through all open `auto-generated` and `architecture` issues |
| `/review` | Run deterministic checks, structured review, and review judge |
| `/architecture` | Analyse the repo for structural friction and create RFC issues |
| `/discover-skills` | Find domain-specific plugins for the current tech stack |
| `/atlassian-login` | Authenticate to Jira/Confluence via OAuth |
| `/atlassian-read` | Read a Jira issue or Confluence page by URL |
| `/datadog-login` | Authenticate to an OAuth-enabled Datadog MCP server |
| `/datadog-status` | Show Datadog MCP auth status |
| `/datadog-logout` | Remove stored Datadog MCP credentials |
| `/datadog` | Resolve a Lambda from repo code and run a Datadog MCP investigation |

## What the dev pipeline expects

Forgeflow-dev assumes the issue already names the intended user-visible slice and any project-shaping stack decisions.

On greenfield projects, that usually means the issue already tells the agent things like:
- framework/runtime
- testing baseline
- auth/provider choice if relevant
- persistence approach if relevant

The planner and implementor now treat those choices as binding rather than improvising a different stack.

## `/implement` in plain English

`/implement` runs a build chain, then a review chain.

### Build chain
1. **planner** — explores the codebase and writes a sequenced test plan
2. **architecture-reviewer** — checks for obvious structural drift
3. **implementor** — implements with strict TDD
4. **refactorer** — cleans up once behaviour is in place

### Review chain
1. **code-reviewer** — cold-start review of the diff
2. **review-judge** — validates findings
3. **fix-findings** — fixes accepted findings when needed

At the end, forgeflow opens or updates a PR for human review.

## `/implement-all` in plain English

`/implement-all` loops through all open `auto-generated` and `architecture` issues in dependency order.
On greenfield repos, that usually means it should take an explicit scaffold/bootstrap issue first, then move onto the dependent feature slices.
For each issue it:
- plans
- implements
- reviews
- opens/updates a PR
- waits for CI
- fixes failed CI up to three times
- merges if successful

## Boundary-aware implementation

Forgeflow prefers feature-oriented structure over flat-root sprawl.
Each issue should name one owning boundary, and the planner/implementor treat that as a gate.

That means:
- prefer extending an existing feature/domain folder
- create a small public entry point when a new boundary is needed (`index.ts`, `__init__.py`, `routes.rb`, or equivalent)
- treat generic roots such as `src/`, `app/`, `server/`, `client/`, `test/`, and `tests/` as roots, not owning boundaries
- avoid `utils/`, `helpers/`, `misc/`, and `lib/` junk drawers
- block if one issue really spans multiple owning boundaries

On greenfield repos, the first slice should establish a real feature/domain boundary beneath the broad source root so `/implement-all` does not normalise flat sibling files as the project grows.

## Library and framework behaviour

On greenfield work, forgeflow should not invent bespoke framework/auth/test plumbing when the issue already chose a direction.

Examples:
- if the issue says Vue/Nuxt, do not hand-build DOM strings
- if the issue says Phoenix LiveView, do not switch to a JS-heavy UI stack
- if the issue says Clerk or ASP.NET Core Identity, do not replace it with custom auth code

If a necessary project-shaping choice is missing and the repo does not already establish one, the implementor should block instead of making an arbitrary decision.

## Configuration

Optional config lives in:
- project: `.forgeflow.json`
- global: `~/.pi/agent/forgeflow.json`

Example:

```json
{
  "agents": {
    "planner": { "thinkingLevel": "high" },
    "implementor": { "thinkingLevel": "medium" },
    "code-reviewer": { "thinkingLevel": "high" },
    "review-judge": { "thinkingLevel": "high" }
  },
  "sessions": {
    "persist": true,
    "archiveRuns": 20,
    "archiveMaxAge": 30
  }
}
```

Valid `thinkingLevel` values: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

Set `sessions.persist` to `false` for sensitive projects where you do not want sub-agent session files written to disk.

## Sessions

Sub-agent sessions are stored under `.forgeflow/run/<runId>/` so runs are resumable.
Successful runs are archived; failed runs are left in place for inspection.

## Atlassian

With Atlassian OAuth configured, you can:
- implement a Jira issue directly: `/implement PROJ-123`
- read a Jira issue or Confluence page: `/atlassian-read <url>`

Environment variables:

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

## Datadog MCP

Forgeflow can route freeform runtime investigations through an OAuth-enabled Datadog MCP server.

Environment variables:

```bash
export DATADOG_MCP_URL=https://your-datadog-mcp.example.com/mcp
export DATADOG_MCP_REDIRECT_URI=http://127.0.0.1:33390/callback
# Optional when your MCP server requires a pre-registered OAuth client
export DATADOG_MCP_CLIENT_ID=...
export DATADOG_MCP_CLIENT_SECRET=...
# Optional OAuth scope override
export DATADOG_MCP_SCOPE="metrics logs traces"
```

Then run:

```text
/datadog-login
/datadog "investigate why the billing lambda is slow in prod"
/datadog "give me p50 p95 and p99 for the billing lambda over the last 24h"
```

The first cut expects a Datadog MCP server that exposes `query-metrics`, `search-logs`, and optionally `search-spans`.

## See also

- Root README: `../../README.md`
- PM package: `../pm/README.md`

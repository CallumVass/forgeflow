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
| `/review` | Review a PR or branch: blocking defects plus advisory architecture and refactor notes |
| `/review-lite` | Review a PR or branch in strict mode: blocking defects only |
| `/architecture` | Analyse the repo for structural friction and create RFC issues |
| `/skill-scan` | Scan common skill locations and explain which installed skills forgeflow would recommend |
| `/skill-recommend` | Recommend missing skills from skills.sh that fit the current repo and stage |
| `/atlassian-login` | Authenticate to an OAuth-enabled Atlassian MCP server |
| `/atlassian-status` | Show Atlassian MCP auth status |
| `/atlassian-logout` | Remove stored Atlassian MCP credentials |
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

## `/review` in plain English

Standalone `/review` is broader than the review chain inside `/implement`.

1. **code-reviewer** — cold-start defect review of the diff
2. **review-judge** — validates blocking findings
3. **architecture-reviewer** — advisory architecture and boundary pass on the changed area
4. **refactor-reviewer** — advisory refactor pass on the changed area

If you are reviewing a GitHub PR in the UI, forgeflow can draft `gh` review comments for the blocking findings, then let you edit, approve, or skip them before anything is posted.

If you want the old narrow behaviour, use `/review-lite` or `/review --strict`. That runs only the blocking review chain (`code-reviewer` → `review-judge`) and skips the advisory architecture/refactor passes.

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

## Auto skill loading

Forgeflow now shortlists relevant skills before `/implement`, `/implement-all`, `/review`, `/review-lite`, and `/architecture`.
It reads skills in place from common agent locations rather than asking teams to migrate them into a forgeflow-specific directory.

Discovery covers common local/global roots such as:
- `.agents/skills/`
- `.pi/skills/`
- `.claude/skills/`
- `.copilot/skills/`
- `.codex/skills/`
- `.opencode/skills/`
- `~/.agents/skills/`
- `~/.pi/agent/skills/`
- `~/.claude/skills/`
- `~/.copilot/skills/`
- `~/.codex/skills/`
- `~/.opencode/skills/`

Selection is repo-aware. Forgeflow looks at things like:
- workspace/package dependencies in `package.json`
- .NET solutions and project files (`.sln`, `*.csproj`)
- `mix.exs`, `pyproject.toml`, `go.mod`, `Cargo.toml`
- changed files for review runs

Use `/skill-scan` to inspect what was discovered and why forgeflow would pick particular installed skills for a command.

Use `/skill-recommend` to look beyond the repo and query [skills.sh](https://skills.sh/) for missing skills worth adding. Forgeflow generates repo-aware search queries from the detected stack, dedupes the results locally, and ranks them against the same repo signals it uses for auto-loading. Recommendations include install commands so you can add the skill and let future forgeflow runs auto-load it. The human-readable report now puts top installs first and, if a discovered local skill is malformed, diagnostics include the exact `SKILL.md` path so you can fix the offending file directly.

Examples:

```text
/skill-recommend
/skill-recommend --for review --branch feat/ui
/skill-recommend --for architecture --path apps/web --limit 5
```

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
  "skills": {
    "enabled": true,
    "extraPaths": ["~/company-shared-skills", "./tools/skills"],
    "maxSelected": 4
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

## Atlassian MCP

With Atlassian MCP configured, you can:
- implement a Jira issue directly: `/implement PROJ-123`
- read a Jira issue or Confluence page: `/atlassian-read <url>`
- check auth state: `/atlassian-status`
- clear stored auth: `/atlassian-logout`

Environment variables:

```bash
export ATLASSIAN_MCP_URL=https://your-atlassian-mcp.example.com/mcp
export ATLASSIAN_MCP_REDIRECT_URI=http://127.0.0.1:33389/callback
# Optional when your MCP server requires a pre-registered OAuth client
export ATLASSIAN_MCP_CLIENT_ID=...
export ATLASSIAN_MCP_CLIENT_SECRET=...
# Optional OAuth scope override
export ATLASSIAN_MCP_SCOPE="read:jira-work read:confluence-content.all"
# Optional site hint for Jira URL generation, multi-site setups,
# and MCP servers that expose separate Jira/Confluence cloud resources for one site
export ATLASSIAN_URL=https://yourcompany.atlassian.net
```

Then run:

```text
/atlassian-login
/atlassian-status
```

If the browser callback completes but you need to retry straight away, you can rerun `/atlassian-login` immediately without waiting for the local OAuth callback port to drain.

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

If the browser callback completes but you need to retry straight away, you can rerun `/datadog-login` immediately without waiting for the local OAuth callback port to drain.

Forgeflow works best with a Datadog MCP server that exposes metric query, metric search/context, and log search tools. The `/datadog` pipeline now discovers likely metric names and tag keys before reporting `no data`, rather than assuming only AWS Lambda runtime metric shapes. It also understands Datadog MCP text responses that wrap results in `<JSON_DATA>` / `<YAML_DATA>` blocks.

## See also

- Root README: `../../README.md`
- PM package: `../pm/README.md`

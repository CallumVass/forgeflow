# @callumvass/forgeflow-pm

PRD and planning commands for [Pi](https://shittycodingagent.ai/).
Use this package when you want to go from an idea to a solid PRD, then to implementation-ready GitHub or Jira issues.

## Install

```bash
npx pi install @callumvass/forgeflow-pm
```

## Start here

### Greenfield project

```text
/init
/prd-qa
# final review/edit of PRD.md
/create-gh-issues
```

Use `/investigate` only if you want a deeper spike before locking a major decision such as framework, auth, persistence, or testing.

### Existing project

```text
/continue "describe the next phase"
```

That updates `PRD.md` with `## Done` / `## Next`, QAs the next phase, then creates issues.

## Commands

| Command | What it does |
|---|---|
| `/init` | Draft a first `PRD.md` for a greenfield project |
| `/prd-qa` | Refine `PRD.md` through the full critic → architect → integrator loop, then prompt for one final review |
| `/continue` | Update `PRD.md` for the next phase on an existing project |
| `/create-gh-issues` | Turn `PRD.md` into vertical-slice GitHub issues |
| `/create-gh-issue` | Create one GitHub issue from a feature idea |
| `/investigate` | Research a topic, compare options, and write a spike/RFC markdown doc |
| `/create-jira-issues` | Turn Confluence PM docs into Jira issues |
| `/atlassian-login` | Authenticate to Jira/Confluence via OAuth |
| `/atlassian-read` | Read a Jira issue or Confluence page by URL |

## What a good greenfield PRD should contain

After `/prd-qa`, a greenfield PRD should usually include:
- clear product goals and MVP flow
- scope and non-goals
- `## Technical Direction` with the chosen stack/framework/testing/auth/persistence decisions where they materially matter
- `## Alternatives Considered` for major project-shaping decisions, kept brief

This gives you an easy review point before issue creation:
- "Use Vue, not React"
- "Use Clerk, not Better Auth"
- "Use ASP.NET Core Identity"
- "Keep this framework-light for MVP"

`/create-gh-issues` treats the chosen option as binding and alternatives as context only.

## `/investigate` in plain English

`/investigate` is a general research command, not just a Confluence feature.

Use it when you want a deeper comparison before editing the PRD, for example:

```text
/investigate "Compare auth options for this app in the chosen ecosystem"
/investigate "Compare suitable frontend/runtime choices for this project"
/investigate "Assess whether the current auth and cookie approach is safe"
```

It:
- explores the codebase
- checks existing dependencies and patterns
- can research the web
- writes a markdown spike/RFC document in the repo

Optional template support:

```text
/investigate "Compare auth options" --template <url>
```

If no template is provided, forgeflow uses a default structure.
Confluence templates are supported, but not required.

## How issue creation works

`/create-gh-issues` creates **vertical slices** for autonomous implementation.
Each issue:
- delivers one user-observable flow
- includes a trigger test
- names one owning boundary and public entry point
- carries forward the chosen technical direction from the PRD

On greenfield repos, `/create-gh-issues` should usually create one small initial scaffold/bootstrap issue first, then the first product slice after it.

That scaffold issue should:
- establish the chosen app/runtime shape and baseline test harness
- establish the first reusable boundary beneath the broad source root
- stay small and observable rather than absorbing the first substantial product feature

Later issues should depend directly or transitively on that scaffold issue.

Generic roots such as `src/`, `app/`, `server/`, `client/`, `test/`, and `tests/` are treated as roots, not owning boundaries. On greenfield repos, the first slices must establish real feature/domain boundaries beneath those roots so later implementation does not drift into a flat source tree.

## Jira and Confluence

If you use Atlassian, configure OAuth once:

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

Extra notes:
- `/atlassian-read <url>` reads a Jira issue or Confluence page into chat
- `/create-jira-issues` turns Confluence PM docs into Jira issues
- `/investigate` can optionally use a Confluence template URL and prefetch Jira/Confluence links mentioned in the topic

Set `ATLASSIAN_JIRA_PROJECT` unless you provide an example Jira ticket URL that lets forgeflow infer the project key.

## Configuration

Optional config lives in:
- project: `.forgeflow.json`
- global: `~/.pi/agent/forgeflow.json`

Example:

```json
{
  "agents": {
    "prd-critic": { "thinkingLevel": "high" },
    "prd-architect": { "thinkingLevel": "medium" },
    "gh-issue-creator": { "thinkingLevel": "high" },
    "investigator": { "thinkingLevel": "high" }
  },
  "sessions": {
    "persist": true,
    "archiveRuns": 20,
    "archiveMaxAge": 30
  }
}
```

Valid `thinkingLevel` values: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

## Sessions

PM pipelines keep resumable sub-agent sessions under `.forgeflow/run/<runId>/`.
On success they are archived; on failure they are left in place so you can inspect or resume them.

## See also

- Root README: `../../README.md`
- Dev package: `../dev/README.md`

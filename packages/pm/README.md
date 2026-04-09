# @callumvass/forgeflow-pm

PM pipeline for [Pi](https://shittycodingagent.ai/) — PRD refinement, issue creation, and investigation.

## Install

```bash
npx pi install @callumvass/forgeflow-pm
```

## Commands

| Command | Description |
|---------|-------------|
| `/prd-qa` | Refine PRD.md via critic → architect → integrator loop |
| `/continue` | Update PRD with Done/Next, QA, then create issues for next phase |
| `/create-gh-issues` | Decompose PRD.md into vertical-slice GitHub issues |
| `/create-gh-issue` | Create a single GitHub issue from a feature idea |
| `/create-jira-issues` | Decompose Confluence PM docs into Jira issues |
| `/investigate` | Spike or RFC: explore codebase + web, fill a Confluence template |
| `/atlassian-login` | Authenticate forgeflow to Atlassian via OAuth |
| `/atlassian-read` | Read a Jira issue or Confluence page by URL via Atlassian OAuth |

## Agents

- **prd-critic** — Reviews PRD.md, outputs questions or signals completion
- **prd-architect** — Answers questions using PRD and codebase context
- **prd-integrator** — Incorporates answers back into PRD.md
- **gh-issue-creator** — Decomposes PRD into vertical-slice GitHub issues
- **gh-single-issue-creator** — Interactive single issue creation from a feature idea
- **jira-issue-planner** — Decomposes Confluence docs into Jira issue drafts for OAuth publishing
- **investigator** — Spike/RFC research agent

## Skills

- **issue-template** — Standard format for GitHub issues, including the mandatory size budget (≤15 tests / ≤10 files / ≤1 integration site), the `## Structural Placement` section, the `## TDD Rehearsal` output section, and the post-draft skill-as-linter audit. Both `create-gh-issue` and `create-gh-issues` enforce these rules via pre-flight checks.
- **prd-quality** — PRD completeness and quality criteria
- **writing-style** — Consistent tone and formatting rules
- **atlassian** — Jira/Confluence workflow guidance, including when to use `/atlassian-read`, `/investigate --template`, and `/create-jira-issues`

## Sub-agent sessions

PM pipelines run through the same `.forgeflow/run/<runId>/` lifecycle as the dev pipelines: each invocation of `create-gh-issues`, `create-gh-issue`, `prd-qa`, `continue`, `investigate`, and `create-jira-issues` is bracketed by `withRunLifecycle`, sub-agents persist their sessions to disk, and the run directory is archived on success or retained on failure for `pi --resume` inspection. See the dev package README for full lifecycle details and the `sessions.persist` opt-out.

## Configuration

Forgeflow reads optional per-agent model and thinking-level overrides plus
sub-agent session persistence settings from `.forgeflow.json` (nearest one
walked up from the current directory) merged over `~/.pi/agent/forgeflow.json`
(global). Both files are optional — with neither, every sub-agent inherits
the parent pi session's model and thinking level and sessions persist with
the default retention.

```json
{
  "agents": {
    "prd-critic":           { "model": "claude-opus-4",   "thinkingLevel": "high" },
    "prd-architect":        { "model": "claude-sonnet-4", "thinkingLevel": "medium" },
    "gh-issue-creator":     { "thinkingLevel": "high" },
    "investigator":         { "thinkingLevel": "high" }
  },
  "sessions": {
    "persist":        true,
    "archiveRuns":    20,
    "archiveMaxAge":  30
  }
}
```

Valid `thinkingLevel` values: `off`, `minimal`, `low`, `medium`, `high`,
`xhigh`. Invalid values and malformed JSON are reported via the pi
notification UI and dropped; the pipeline still runs with inherited
defaults.

## Boundary-aware issue generation

GitHub issue creation is now structure-aware. Every generated issue names exactly one owning boundary, its public entry point, the files in scope for that slice, and placements to avoid.

That means:
- `create-gh-issues` prefers extending an existing feature or domain folder before creating a new one
- `create-gh-issue` splits or narrows ideas that would otherwise span multiple owning boundaries
- issue bodies steer implementors away from flat package roots and catch-all folders such as `utils/` or `helpers/`

This makes the generated issues much safer for greenfield codebases, where folder shape can drift quickly if slices do not name a clear home.

## Atlassian OAuth

Create an Atlassian OAuth app in https://developer.atlassian.com/console/myapps/, add the callback URL `http://127.0.0.1:33389/callback`, grant `offline_access`, `read:jira-work`, `write:jira-work`, and `read:confluence-content.all`, then export `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `ATLASSIAN_URL`, and `ATLASSIAN_REDIRECT_URI`. After that, run `/atlassian-login`.

With OAuth configured:
- `/investigate` and `/create-jira-issues` fetch Confluence pages through Atlassian OAuth, with a legacy Confluence REST fallback for sites where the newer v2 endpoint rejects classic OAuth scopes
- `/create-jira-issues` can also accept a Jira example ticket URL
- `/atlassian-read <jira-or-confluence-url>` fetches and prints the linked Jira issue or Confluence page
- `/investigate` now also prefetches extra Jira and Confluence URLs mentioned in the investigation description, beyond the explicit `--template` page
- The bundled `atlassian` skill tells the agent how to route Jira/Confluence requests and how to handle extra reference links during investigations
- forgeflow publishes Jira issues itself via OAuth

Set `ATLASSIAN_JIRA_PROJECT` unless you provide a Jira example ticket URL that lets forgeflow infer the project key.

## Usage examples

See the [root README](../../README.md#commands) for detailed usage examples of each command.

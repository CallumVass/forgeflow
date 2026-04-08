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

## Agents

- **prd-critic** — Reviews PRD.md, outputs questions or signals completion
- **prd-architect** — Answers questions using PRD and codebase context
- **prd-integrator** — Incorporates answers back into PRD.md
- **gh-issue-creator** — Decomposes PRD into vertical-slice GitHub issues
- **gh-single-issue-creator** — Interactive single issue creation from a feature idea
- **jira-issue-creator** — Decomposes Confluence docs into Jira issues
- **investigator** — Spike/RFC research agent

## Skills

- **issue-template** — Standard format for GitHub issues, including the mandatory size budget (≤15 tests / ≤10 files / ≤1 integration site), the `## TDD Rehearsal` output section, and the post-draft skill-as-linter audit. Both `create-gh-issue` and `create-gh-issues` enforce these rules via pre-flight checks.
- **prd-quality** — PRD completeness and quality criteria
- **writing-style** — Consistent tone and formatting rules

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

## Usage examples

See the [root README](../../README.md#commands) for detailed usage examples of each command.

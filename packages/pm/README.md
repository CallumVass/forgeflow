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

- **issue-template** — Standard format for GitHub issues
- **prd-quality** — PRD completeness and quality criteria
- **writing-style** — Consistent tone and formatting rules

## Configuration

Forgeflow reads optional per-agent model and thinking-level overrides from
`.forgeflow.json` (nearest one walked up from the current directory) merged
over `~/.pi/agent/forgeflow.json` (global). Project entries replace whole
global entries at the agent level. Both files are optional — with neither,
every sub-agent inherits the parent pi session's model and thinking level.

```json
{
  "agents": {
    "prd-critic":           { "model": "claude-opus-4",   "thinkingLevel": "high" },
    "prd-architect":        { "model": "claude-sonnet-4", "thinkingLevel": "medium" },
    "gh-issue-creator":     { "thinkingLevel": "high" },
    "investigator":         { "thinkingLevel": "high" }
  }
}
```

Valid `thinkingLevel` values: `off`, `minimal`, `low`, `medium`, `high`,
`xhigh`. Invalid values and malformed JSON are reported via the pi
notification UI and dropped; the pipeline still runs with inherited
defaults.

## Usage examples

See the [root README](../../README.md#commands) for detailed usage examples of each command.

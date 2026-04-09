# @callumvass/forgeflow-dev

Dev pipeline for [Pi](https://shittycodingagent.ai/) — TDD implementation, code review, architecture, and skill discovery.

## Install

```bash
npx pi install @callumvass/forgeflow-dev
```

## Commands

| Command | Description |
|---------|-------------|
| `/implement` | Implement a single issue using TDD (plan → implement → refactor → review), then open/update a PR for human review |
| `/implement-all` | Loop through all open `auto-generated` and `architecture` issues: implement, review, merge |
| `/review` | Code review: deterministic checks → reviewer → judge; PR targets are checked out before review |
| `/architecture` | Analyze codebase for architectural friction, create RFC issues |
| `/discover-skills` | Find and install domain-specific plugins for your tech stack |
| `/atlassian-login` | Authenticate forgeflow to Atlassian via OAuth |
| `/atlassian-read` | Read a Jira issue or Confluence page by URL via Atlassian OAuth |

## Agents

- **planner** — Reads an issue, explores the codebase, outputs sequenced test cases
- **implementor** — TDD implementation with red-green-refactor
- **refactorer** — Post-implementation cleanup, extracts shared patterns
- **code-reviewer** — Structured checklist-driven code review
- **review-judge** — Validates review findings against actual code
- **architecture-reviewer** — Identifies structural friction and proposes RFCs
- **skill-discoverer** — Finds domain-specific plugins for the project

## Skills

- **tdd** — Test-driven development with red-green-refactor loop
- **code-review** — Structured review with confidence scoring
- **opensrc** — Fetch library source code for reference
- **stitch** — UI design reference integration
- **plugins** — Domain-specific review plugin router

## Boundary-aware implementation

`/implement` and `/implement-all` now preserve feature-oriented structure more aggressively.

Before writing code, the planner names one owning boundary for the slice, the public entry point for that boundary, likely files in scope, and placements to avoid. The implementor treats that boundary choice as a gate: it prefers extending an existing feature or domain folder, creates a small public `index.ts` when a new boundary is needed, and blocks when one issue would need multiple owning boundaries.

The architecture reviewer now looks for flat-root sprawl, boundaryless growth, junk-drawer folders such as `utils/`, and cross-feature internal imports. The code reviewer also checks obvious boundary drift when reviewing a diff.

This matters most on greenfield repos and in `/implement-all`, where a stream of small issues can otherwise turn into a flat source tree over time.

## Sub-agent sessions and the fork architecture

`/implement` runs sub-agents in two chains joined by a hard boundary:

- **Build chain** — `planner` → `architecture-reviewer` → `implementor` → `refactorer`. Every phase is forked from the previous one via `pi --fork`, so the implementor inherits the planner's file reads, the architecture-reviewer's critique, and everything else as real conversation history. No re-exploration, no prompt blobs.
- **Review chain** — `code-reviewer` → `review-judge` → `fix-findings`. The reviewer cold-starts to preserve adversarial independence from the build chain; the judge and fix-findings then fork within the review chain so they inherit the reviewer's cold-eye reads plus findings without picking up the implementor's reasoning. Findings now stay in agent output and forked session history rather than being written to `FINDINGS.md`.

Sub-agent sessions persist under `.forgeflow/run/<runId>/` (gitignored on first creation) so any phase is resumable via `pi --resume .forgeflow/run/<runId>/<nn>-<agent>.jsonl`. On success the directory is moved under `.forgeflow/run/archive/<timestamp>-<runId>-success/`; on failure or interruption it stays in place for inspection until the next run archives it. Archived runs are GC'd on pipeline entry: the newest 20 survive, anything older than 30 days is pruned.

`/implement` stops after pushing commits and opening or updating the PR so a human can review, approve, and merge in the normal team flow.

`/implement-all` waits for CI to finish on each PR before merging. If any check fails, it fetches the failed-job logs via `gh run view --log-failed`, spawns the implementor to fix the failures, and re-waits. Capped at three fix attempts per PR; the cap means a genuinely broken PR cannot loop forever.

## Configuration

Forgeflow reads optional per-agent model and thinking-level overrides plus
sub-agent session persistence settings from `.forgeflow.json` (nearest one
walked up from the current directory) merged over `~/.pi/agent/forgeflow.json`
(global). Project entries replace whole global entries at the agent level;
the `sessions` block merges field-by-field so a project file that tweaks one
retention knob does not clobber a global opt-out. Both files are optional.

```json
{
  "agents": {
    "planner":          { "model": "claude-opus-4",   "thinkingLevel": "high" },
    "implementor":      { "model": "claude-sonnet-4", "thinkingLevel": "medium" },
    "code-reviewer":    { "thinkingLevel": "high" },
    "review-judge":     { "thinkingLevel": "high" }
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

**Opt-out for sensitive projects.** Setting `sessions.persist` to `false`
reverts every sub-agent to the legacy `--no-session` behaviour project-wide:
no run directory is created, nothing is written to disk, and fork-based
context sharing is disabled. Use this for projects whose agents routinely
read secrets or private source you do not want materialised in session
files.

## Atlassian OAuth

Create an Atlassian OAuth app in https://developer.atlassian.com/console/myapps/, add the callback URL `http://127.0.0.1:33389/callback`, grant `offline_access`, `read:jira-work`, `write:jira-work`, and `read:confluence-content.all`, then export `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `ATLASSIAN_URL`, and `ATLASSIAN_REDIRECT_URI`. After that, run `/atlassian-login`. Atlassian OAuth then powers `/implement PROJ-123` for Jira-backed implementation and `/atlassian-read <jira-or-confluence-url>` for quick ticket/page reads.

## Usage examples

See the [root README](../../README.md#commands) for detailed usage examples of each command.

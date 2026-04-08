# @callumvass/forgeflow-dev

Dev pipeline for [Pi](https://shittycodingagent.ai/) — TDD implementation, code review, architecture, and skill discovery.

## Install

```bash
npx pi install @callumvass/forgeflow-dev
```

## Commands

| Command | Description |
|---------|-------------|
| `/implement` | Implement a single issue using TDD (plan → implement → refactor → review) |
| `/implement-all` | Loop through all open `auto-generated` and `architecture` issues: implement, review, merge |
| `/review` | Code review: deterministic checks → reviewer → judge |
| `/architecture` | Analyze codebase for architectural friction, create RFC issues |
| `/discover-skills` | Find and install domain-specific plugins for your tech stack |

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

## Usage examples

See the [root README](../../README.md#commands) for detailed usage examples of each command.

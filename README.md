# forgeflow

Agentic software delivery pipeline for [Pi](https://pi.dev). Takes a PRD through to merged pull requests via structured agent orchestration.

## Pipeline

```
PRD.md → /prd-qa → /create-issues → /implement → /review
```

## Install

```bash
pi install git:github.com/callumvass/forgeflow
```

## Commands

| Command | Description |
|---------|-------------|
| `/prd-qa` | Refine PRD via critic → architect → integrator loop |
| `/create-issues` | Decompose PRD into vertical-slice GitHub issues |
| `/implement <issue>` | Plan → implement → refactor with TDD |
| `/review [PR\|branch]` | Deterministic checks → code review → judge |

## Agents

Worker agents spawned by pipeline extensions:

- **prd-critic** — Reviews PRD completeness, outputs questions or signals complete
- **prd-architect** — Answers PRD questions using codebase context
- **prd-integrator** — Incorporates answers into PRD, strips implementation detail
- **issue-creator** — Decomposes PRD into vertical-slice GitHub issues
- **planner** — Produces sequenced test cases for TDD implementation
- **implementor** — Strict TDD red-green-refactor
- **refactorer** — Post-implementation deduplication and pattern extraction
- **code-reviewer** — Checklist-driven review with evidence requirements
- **review-judge** — Validates reviewer findings against actual code

## Skills

- **tdd** — Test-driven development philosophy and workflow
- **code-review** — Structured review checklist with confidence scoring
- **prd-quality** — PRD completeness criteria
- **issue-template** — Standard GitHub issue format for autonomous implementation
- **opensrc** — Library source code fetching
- **stitch** — UI design system integration
- **review-plugins** — Domain-specific review enhancements

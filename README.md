# forgeflow

Agentic software delivery pipeline for [Pi](https://pi.dev). Takes a PRD through to merged pull requests.

```
PRD.md → /prd-qa → /create-issues → /implement-all → merged PRs
```

## Install

```bash
pi install git:github.com/callumvass/forgeflow
```

## Update

```bash
pi update forgeflow
```

## Prerequisites

- [Pi](https://pi.dev) CLI installed
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated — used for issues, PRs, and merges
- A GitHub repo with issues enabled

## Commands

### PRD refinement

```
/prd-qa [maxIterations]
```

Runs a critic → architect → integrator loop on `PRD.md`. Each iteration:
1. **Critic** reviews the PRD, creates `QUESTIONS.md` if incomplete
2. **Architect** answers questions using codebase context
3. **Integrator** merges answers back into `PRD.md`

In interactive mode, you review/edit the PRD after each iteration and choose to continue or accept.

### Issue creation

```
/create-issues
/create-issue "Add user authentication"
```

`/create-issues` decomposes `PRD.md` into vertical-slice GitHub issues (each labeled `auto-generated`), ordered by dependencies.

`/create-issue` creates a single issue from a feature idea.

### Implementation

```
/implement 42
/implement 42 --skip-plan
/implement 42 --skip-review
/implement                    # detects issue from branch name (e.g. feat/issue-42)
```

Implements a single issue:
1. **Planner** — reads issue + codebase, outputs sequenced test cases
2. *Plan approval* — in interactive mode, you review/edit the plan before proceeding
3. *Branch creation* — creates `feat/issue-<N>` if on main
4. **Implementor** — strict TDD (red-green-refactor), commits, pushes, creates PR
5. **Refactorer** — deduplication and pattern extraction
6. **Code reviewer + Judge** — checklist-driven review with evidence validation

### Implement all

```
/implement-all
/implement-all --skip-plan --skip-review
```

Loops through all open `auto-generated` issues in dependency order. For each issue:
1. Runs the full `/implement` pipeline
2. Merges the PR (squash + delete branch)
3. Returns to main and picks the next ready issue

Stops on failure or when all issues are done.

### Code review

```
/review            # review current branch vs main
/review 42         # review PR #42
/review --branch feat/thing
```

Runs code-reviewer (checklist-driven, evidence-required) then review-judge (filters noise, validates findings).

## Agents

Worker agents spawned by pipelines — not called directly:

| Agent | Role |
|-------|------|
| `prd-critic` | Reviews PRD completeness, creates `QUESTIONS.md` if incomplete |
| `prd-architect` | Answers questions using codebase context |
| `prd-integrator` | Merges answers into PRD, strips implementation detail |
| `issue-creator` | Decomposes PRD into vertical-slice GitHub issues |
| `single-issue-creator` | Creates a single issue from a feature idea |
| `planner` | Produces sequenced test cases for TDD |
| `implementor` | Strict TDD red-green-refactor |
| `refactorer` | Post-implementation deduplication |
| `code-reviewer` | Checklist-driven review with confidence scoring |
| `review-judge` | Validates findings against actual code |

## Skills

Reference material loaded by agents:

| Skill | Purpose |
|-------|---------|
| `tdd` | Boundary-only testing, red-green-refactor workflow |
| `code-review` | Review checklist, severity levels, evidence format |
| `prd-quality` | PRD completeness criteria |
| `issue-template` | Standard issue format for autonomous implementation |
| `opensrc` | Fetch library source code for reference |
| `stitch` | UI design system integration |
| `review-plugins` | Domain-specific review enhancements (e.g. Tailwind) |

## Signal files

Pipelines use files as control flow signals between agents:

| File | Meaning |
|------|---------|
| `QUESTIONS.md` | PRD needs refinement (created by critic, consumed by architect) |
| `BLOCKED.md` | Implementor hit an unresolvable blocker |
| `FINDINGS.md` | Code review found actionable issues |

# forgeflow

A skill pack for [Pi](https://shittycodingagent.ai/) that turns a PRD into merged pull requests. Install it into Pi, run commands inside your project repo, and it handles the full loop — refinement, issue creation, TDD implementation, code review, and merge.

```
PRD.md → /prd-qa → /create-issues → /implement-all → merged PRs
```

## Getting started

1. Install the skill pack and open your project:
   ```bash
   pi install git:github.com/callumvass/forgeflow
   cd your-project
   ```

2. Write a `PRD.md` in your project root describing what you want to build.

3. Refine, decompose, and implement:
   ```
   /prd-qa              # refine PRD until complete
   /create-issues       # decompose into GitHub issues
   /implement-all       # TDD through each issue, merge PRs
   ```

That's it. Each command is also useful standalone — see below.

## Update

```bash
pi update forgeflow
```

## Prerequisites

- [Pi](https://shittycodingagent.ai/) CLI installed
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated — used for issues, PRs, and merges
- A GitHub repo with issues enabled
- All commands run inside your project repo

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

Implements a single issue (interactive — shows plan for approval):
1. **Planner** — reads issue + codebase, outputs sequenced test cases
2. **Plan approval** — you review/edit the plan before proceeding
3. **Branch creation** — creates `feat/issue-<N>` if on main
4. **Implementor** — strict TDD (red-green-refactor), commits, pushes, creates PR
5. **Refactorer** — deduplication and pattern extraction
6. **Code reviewer + Judge** — if findings, implementor fixes them automatically

### Implement all

```
/implement-all
/implement-all --skip-plan --skip-review
```

Autonomous loop through all open `auto-generated` issues in dependency order. For each issue:
1. Runs the full `/implement` pipeline (skips plan approval)
2. Merges the PR (squash + delete branch)
3. Returns to main and picks the next ready issue

Stops on failure or when all issues are done.

### Code review

```
/review            # review current branch vs main
/review 42         # review PR #42
/review --branch feat/thing
```

Runs code-reviewer → review-judge. If findings survive validation and a PR is detected, proposes `gh api` commands to post inline review comments. You approve before anything is posted.

## How it composes

Each pipeline builds on the one below it:

```
/implement-all
  └─ /implement (autonomous, per issue)
       ├─ planner → implementor → refactorer
       └─ /review (findings → implementor fixes them)
            └─ code-reviewer → review-judge
```

`/review` is the base. `/implement` adds TDD + fix loop. `/implement-all` adds the issue loop + merge.

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

# forgeflow

A skill pack for [Pi](https://shittycodingagent.ai/) that turns a PRD into merged pull requests. Split into two packages so you can install just what you need.

```
PRD.md → /prd-qa → /create-gh-issues → /implement-all → merged PRs
```

## Packages

| Package | npm | What it does |
|---------|-----|-------------|
| `@callumvass/forgeflow-pm` | `pi install npm:@callumvass/forgeflow-pm` | PRD refinement, GitHub/Jira issue creation, spikes, RFCs |
| `@callumvass/forgeflow-dev` | `pi install npm:@callumvass/forgeflow-dev` | TDD implementation, code review, architecture, skill discovery |

Install both for the full pipeline, or just one.

## Getting started

```bash
pi install npm:@callumvass/forgeflow-pm
pi install npm:@callumvass/forgeflow-dev
cd your-project
```

Write a `PRD.md` in your project root, then:

```
/prd-qa              # refine PRD until complete
/create-gh-issues    # decompose into GitHub issues
/implement-all       # TDD through each issue, merge PRs
```

## Update

```bash
pi update @callumvass/forgeflow-pm
pi update @callumvass/forgeflow-dev
```

## Prerequisites

### Required

- [Pi](https://shittycodingagent.ai/) CLI installed
- All commands run inside your project repo

### GitHub (`/create-gh-issues`, `/implement`, `/review`)

- [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`)
- A GitHub repo with issues enabled

### Jira (`/jira-issues`, `/implement PROJ-123`)

- [Jira CLI](https://github.com/ankitpokhrel/jira-cli) installed and authenticated (`jira init`)

### Confluence (`/investigate`, `/jira-issues`)

Set these environment variables (add to your shell profile):

```bash
export CONFLUENCE_URL=https://yourcompany.atlassian.net
export CONFLUENCE_EMAIL=you@company.com
export CONFLUENCE_TOKEN=your-api-token
```

Generate an API token at https://id.atlassian.com/manage-profile/security/api-tokens

## Commands

### PM commands (`@callumvass/forgeflow-pm`)

#### PRD refinement

```
/prd-qa [maxIterations]
```

Runs a critic → architect → integrator loop on `PRD.md`. Each iteration:
1. **Critic** reviews the PRD, creates `QUESTIONS.md` if incomplete
2. **Architect** answers questions using codebase context
3. **Integrator** merges answers back into `PRD.md`

In interactive mode, you review/edit the PRD after each iteration and choose to continue or accept.

#### GitHub issue creation

```
/create-gh-issues
/create-gh-issue "Add user authentication"
```

`/create-gh-issues` decomposes `PRD.md` into vertical-slice GitHub issues (each labelled `auto-generated`), ordered by dependencies.

`/create-gh-issue` creates a single issue from a feature idea.

#### Jira issue creation

```
/jira-issues <confluence-url> [confluence-url...] [--example <confluence-url>]
```

Decomposes one or more Confluence PM documents into vertical-slice Jira issues. Optionally provide an example ticket link so the agent matches your team's format.

#### Investigation (spikes and RFCs)

```
/investigate "how should we handle auth?" --template https://yourcompany.atlassian.net/wiki/spaces/.../pages/123
/investigate "evaluate caching strategies"
```

Explores the codebase and web, then fills in a Confluence template (spike, RFC, or similar). Without `--template`, uses a default structure: Problem, Context, Options, Recommendation, Next Steps.

#### Continue

```
/continue ["description of next phase"]
```

Updates PRD with Done/Next based on codebase state, QAs the Next section, then creates GitHub issues.

### Dev commands (`@callumvass/forgeflow-dev`)

#### Implementation

```
/implement 42                       # GitHub issue
/implement PROJ-123                 # Jira issue
/implement 42 "focus on error handling"  # with custom prompt
/implement 42 --skip-plan
/implement 42 --skip-review
/implement                          # detects issue from branch name
```

Implements a single issue (interactive, shows plan for approval):
1. **Planner** reads issue + codebase, outputs sequenced test cases
2. **Plan approval** you review/edit the plan before proceeding
3. **Branch creation** creates `feat/issue-<N>` if on main
4. **Implementor** strict TDD (red-green-refactor), commits, pushes, creates PR
5. **Refactorer** deduplication and pattern extraction
6. **Code reviewer + Judge** if findings, implementor fixes them automatically

Uses the repo's pull request template (`.github/pull_request_template.md`) if one exists.

#### Implement all

```
/implement-all
/implement-all --skip-plan --skip-review
```

Autonomous loop through all open `auto-generated` issues in dependency order.

#### Code review

```
/review                                # review current branch vs main
/review 42                             # review PR #42
/review --branch feat/thing
/review 42 "check for SQL injection"   # with custom prompt
```

Runs code-reviewer → review-judge.

#### Skill discovery

```
/discover-skills                   # auto-detect tech stack, find relevant plugins
/discover-skills "tailwind"        # search for a specific technology
```

#### Architecture review

```
/architecture
```

Analyses the codebase for architectural friction and creates RFC issues.

## Development

```bash
npm install
npm run build        # build both packages
npm run typecheck    # typecheck all packages
npm run check        # typecheck + lint
```

Releases are automated via [release-please](https://github.com/googleapis/release-please). Push to main with conventional commit messages (`feat:`, `fix:`) and a release PR is created automatically. Merging the release PR publishes to npm.

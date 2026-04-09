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

If you are starting from a blank repo, you can skip the first step:

```
/init                # draft an initial PRD interactively
/prd-qa              # refine it until complete
```

`/prd-qa` still offers the same bootstrap flow if `PRD.md` does not exist yet.

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

### Atlassian OAuth (`/atlassian-login`, `/atlassian-read`, `/create-jira-issues`, `/investigate`, `/implement PROJ-123`)

Forgeflow uses Atlassian OAuth for Jira and Confluence access.

### Create an Atlassian OAuth app

1. Open the Atlassian developer console:
   - https://developer.atlassian.com/console/myapps/
2. Create an OAuth 2.0 app.
3. Add this callback URL:
   - `http://127.0.0.1:33389/callback`
4. Add these scopes:
   - `offline_access`
   - `read:jira-work`
   - `write:jira-work`
   - `read:confluence-content.all`
   - `read:page:confluence`
   - `read:content.metadata:confluence`
   - `read:content-details:confluence`
   - `read:space:confluence`
5. Copy the app's **Client ID** and **Client secret**.

Your organisation may require admin approval before the app can access your Jira / Confluence site.

Set these environment variables (add to your shell profile):

```bash
export ATLASSIAN_CLIENT_ID=your-oauth-client-id
export ATLASSIAN_CLIENT_SECRET=your-oauth-client-secret
export ATLASSIAN_URL=https://yourcompany.atlassian.net
# Must match a redirect URI configured on your Atlassian OAuth app
export ATLASSIAN_REDIRECT_URI=http://127.0.0.1:33389/callback
# Optional: override the default requested scopes explicitly
export ATLASSIAN_SCOPES="offline_access read:jira-work write:jira-work read:confluence-content.all read:page:confluence read:content.metadata:confluence read:content-details:confluence read:space:confluence"
# Required for Jira issue creation unless you pass a Jira example ticket URL
export ATLASSIAN_JIRA_PROJECT=PROJ
# Optional, defaults to Story
export ATLASSIAN_JIRA_ISSUE_TYPE=Story
```

Then run:

```bash
/atlassian-login
```

Forgeflow will print an Atlassian OAuth URL in the widget/terminal. Copy it into your browser to complete login. If you change Atlassian scopes later, delete `~/.pi/agent/forgeflow-atlassian-oauth.json` and re-run `/atlassian-login` so the refreshed consent flow picks them up.

Once logged in, you can also read Jira issues or Confluence pages directly:

```bash
/atlassian-read https://yourcompany.atlassian.net/browse/PROJ-123
/atlassian-read https://yourcompany.atlassian.net/wiki/spaces/ENG/pages/123456/Design
```

Forgeflow stores the OAuth refresh/access token under `~/.pi/agent/forgeflow-atlassian-oauth.json`.

## Commands

### PM commands (`@callumvass/forgeflow-pm`)

#### PRD initialisation

```
/init
```

Drafts an initial `PRD.md` for a greenfield project from a short interactive questionnaire. The generated PRD includes the product summary, MVP flow, and a `## Technical Direction` section covering decision-level choices such as stack, framework/template preference, persistence, auth, and hosting.

#### PRD refinement

```
/prd-qa [maxIterations]
```

Runs a critic → architect → integrator loop on `PRD.md`. If `PRD.md` is missing and you are in interactive mode, forgeflow first offers the same bootstrap questionnaire used by `/init`. Each iteration:
1. **Critic** reviews the PRD, creates `QUESTIONS.md` if incomplete
2. **Architect** answers questions using codebase context
3. **Integrator** merges answers back into `PRD.md`

In interactive mode, you review/edit the PRD after each iteration and choose to continue or accept.

#### GitHub issue creation

```
/create-gh-issues
/create-gh-issue "Add user authentication"
```

`/create-gh-issues` decomposes `PRD.md` into vertical-slice GitHub issues (each labelled `auto-generated`), ordered by dependencies. Each generated issue now includes a `## Structural Placement` section naming one owning boundary, its public entry point, and placements to avoid.

`/create-gh-issue` creates a single issue from a feature idea and applies the same single-boundary placement rules.

#### Jira issue creation

```
/create-jira-issues <confluence-url> [confluence-url...] [--example <confluence-url>]
/atlassian-read <jira-or-confluence-url>
```

Decomposes one or more Confluence PM documents into vertical-slice Jira issues. Optionally provide an example ticket link so the agent matches your team's format.

`/atlassian-read` fetches a Jira issue or Confluence page by URL and prints the contents into the chat.

#### Investigation (spikes and RFCs)

```
/investigate "how should we handle auth?" --template https://yourcompany.atlassian.net/wiki/spaces/.../pages/123
/investigate "evaluate caching strategies"
```

Explores the codebase and web, then fills in a Confluence template (spike, RFC, or similar). Without `--template`, uses a default structure: Problem, Context, Options, Recommendation, Next Steps. Extra Jira and Confluence URLs mentioned in the investigation description are also prefetched as reference material. The PM package also ships an `atlassian` skill that teaches the agent when to use `/atlassian-read`, how Jira and Confluence inputs differ, and how to handle Atlassian reference links during investigations.

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
7. **Stop at PR** the PR is left open for human review/approval/merge

Uses the repo's pull request template (`.github/pull_request_template.md`) if one exists.

#### Implement all

```
/implement-all
/implement-all --skip-plan --skip-review
```

Autonomous loop through all open `auto-generated` and `architecture` issues in dependency order.

#### Code review

```
/review                                # review current branch vs main
/review 42                             # check out and review PR #42
/review --branch feat/thing
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

## Per-stage model overrides

Forgeflow can route different pipeline stages to different pi models and thinking
levels — for example, run cheap recon on Haiku with `thinking: off`, planning and
review on Opus with `thinking: high`, and implementation on Sonnet with
`thinking: medium`. Each stage agent has its own entry in `forgeflow.json` keyed
by the agent file stem.

### Config locations

Forgeflow reads two files and merges them (project wins at the agent-entry level):

| Scope   | Path                              | Precedence |
|---------|-----------------------------------|------------|
| Global  | `~/.pi/agent/forgeflow.json`      | lower      |
| Project | `.forgeflow.json` (nearest ancestor of `cwd`) | higher     |

Omitting a file, an `agents` entry, or any individual field keeps today's
behaviour: every stage inherits whatever model and thinking level the parent
`pi` session has active. Running `pi --model X --thinking high` followed by a
forgeflow pipeline with no config still uses model X and thinking high for
every stage.

### Example

```json
{
  "agents": {
    "planner":               { "model": "claude-opus-4-5",   "thinkingLevel": "high" },
    "implementor":           { "model": "claude-sonnet-4-5", "thinkingLevel": "medium" },
    "refactorer":            { "model": "claude-sonnet-4-5", "thinkingLevel": "medium" },
    "code-reviewer":         { "model": "claude-opus-4-5",   "thinkingLevel": "high" },
    "review-judge":          { "model": "claude-haiku-4-5",  "thinkingLevel": "low" },
    "architecture-reviewer": { "model": "claude-opus-4-5",   "thinkingLevel": "high" },
    "skill-discoverer":      { "model": "claude-haiku-4-5",  "thinkingLevel": "off" },

    "prd-architect":         { "model": "claude-opus-4-5",   "thinkingLevel": "high" },
    "prd-critic":            { "model": "claude-opus-4-5",   "thinkingLevel": "high" },
    "prd-integrator":        { "model": "claude-sonnet-4-5", "thinkingLevel": "medium" },
    "investigator":          { "model": "claude-sonnet-4-5", "thinkingLevel": "medium" },
    "gh-issue-creator":      { "model": "claude-sonnet-4-5", "thinkingLevel": "medium" },
    "gh-single-issue-creator": { "model": "claude-sonnet-4-5", "thinkingLevel": "medium" },
    "jira-issue-creator":    { "model": "claude-sonnet-4-5", "thinkingLevel": "medium" }
  }
}
```

Keys are the stem of the agent `.md` file (`packages/dev/agents/*.md`,
`packages/pm/agents/*.md`). Every field is optional — `{ "planner": { "thinkingLevel": "high" } }`
only bumps the thinking budget and leaves the model inherited, while
`{ "planner": { "model": "claude-opus-4-5" } }` only switches the model.

Supported `thinkingLevel` values (mirrors `pi --thinking`): `off`, `minimal`,
`low`, `medium`, `high`, `xhigh`.

Unknown agent names in the config are ignored silently. Invalid
`thinkingLevel` values are dropped with a warning (the sibling `model` field
still applies). Malformed JSON does not crash a pipeline — the loader logs a
single warning and every stage runs with inherited defaults.

## Development

```bash
npm install
npm run build        # build both packages
npm run typecheck    # typecheck all packages
npm run check        # typecheck + lint + knip + tests
```

Releases are automated via [release-please](https://github.com/googleapis/release-please). Push to main with conventional commit messages (`feat:`, `fix:`) and a release PR is created automatically. Merging the release PR publishes to npm.

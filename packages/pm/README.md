# @callumvass/forgeflow-pm

PM pipeline for [Pi](https://github.com/nicholasgriffintn/pi) — PRD refinement, issue creation, and investigation.

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
| `/jira-issues` | Decompose Confluence PM docs into Jira issues |
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

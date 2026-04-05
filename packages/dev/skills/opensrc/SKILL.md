---
name: opensrc
description: Fetch source code for any library into the project so the agent can reference implementation details. npm packages by name, or any GitHub repo using owner/repo syntax.
---

# opensrc

Fetch source code for libraries and GitHub repositories so you can reference actual implementations, not just types or docs. Works for **any language**.

## When to Use

- You need to understand how a library works internally
- You want to verify an API before using it (training data may be outdated)
- User asks to fetch/download source for any library or GitHub repo

## Key Rule: npm name vs GitHub owner/repo

- **npm packages** (JS/TS only): use the bare package name — `opensrc zod`
- **Everything else** (C#, Elixir, Python, Ruby, Go, etc.): use `owner/repo` GitHub syntax — `opensrc xunit/xunit`

## Quick Reference

```bash
# npm packages
npx opensrc zod
npx opensrc react react-dom next   # multiple at once
npx opensrc zod@3.22.0             # specific version

# GitHub repos (any language)
npx opensrc owner/repo
npx opensrc owner/repo@v1.0.0      # specific tag
npx opensrc owner/repo#main        # specific branch

# Mix npm and GitHub
npx opensrc zod xunit/xunit Valian/live_vue

# List / remove
npx opensrc list
npx opensrc remove zod
```

## Output Structure

Sources live in `opensrc/`:

```
opensrc/
├── sources.json       # index of all fetched sources
└── zod/
    ├── src/
    └── package.json
```

GitHub repos stored as `opensrc/owner--repo/`.

## Version Detection for Non-JS Languages

opensrc only auto-detects versions from JS lockfiles. For other languages, look up the version and pass as `owner/repo@<tag>`:

- **Elixir** — read `mix.lock`: `npx opensrc Valian/live_vue@v0.3.4`
- **C#** — read `.csproj`: `npx opensrc xunit/xunit@2.9.3`
- **Python** — read `pyproject.toml`: `npx opensrc encode/httpx@0.27.0`
- **Ruby** — read `Gemfile.lock`: `npx opensrc rails/rails@v7.2.1`

If tag format doesn't match, check actual tags: `gh api repos/<owner>/<repo>/tags --jq '.[].name' | head -20`

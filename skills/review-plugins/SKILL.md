---
name: review-plugins
description: Domain-specific review plugin router. Scans plugins, matches triggers against a diff, returns which plugins to load.
---

# Review Plugins

This skill provides domain-specific review enhancements that are progressively loaded based on the content of the diff being reviewed.

## Plugin Structure

Each plugin lives in a subdirectory of this skill's directory:

```
review-plugins/
  <name>/
    PLUGIN.md              # Triggers + checklist (always read when matched)
    references/            # Deep context (read lazily per-finding)
      *.md
```

Each `PLUGIN.md` has YAML frontmatter with trigger conditions:

```yaml
---
name: Human-readable name
description: One-line description
triggers:
  files: ["*.tsx", "*.jsx"]    # Glob patterns for changed files
  content: ["useQuery", "cn("] # Literal strings to search for in the diff
---
```

## How to Match Plugins

Given a diff, scan each plugin subdirectory and read its `PLUGIN.md` frontmatter:

1. **files**: At least one changed file in the diff matches any of the plugin's file glob patterns.
2. **content**: At least one of the plugin's content strings appears anywhere in the diff text.

Both conditions must be true for a plugin to match.

## Progressive Disclosure Layers

1. **Trigger scan** (this skill) — read only frontmatter, decide which plugins match. Cheap.
2. **Plugin checklist** — read the matched `PLUGIN.md` body for additional review checks. Medium cost.
3. **Plugin references** — read files from `references/` only when a specific finding needs deeper context. Expensive, on-demand only.

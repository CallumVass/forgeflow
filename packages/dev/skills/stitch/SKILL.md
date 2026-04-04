---
name: stitch
description: Stitch UI design reference. DESIGN.md is the styling authority, Stitch screens are the layout authority. Use when implementing UI with design system integration.
---

# Stitch — UI Design Reference

Stitch is the source of truth for UI design. It provides two things:

1. **DESIGN.md** — a design system document in the project root. Contains colors, typography, components, spacing, do's/don'ts. This is your styling bible.
2. **Screens** — HTML mockups stored in a Stitch project. Each screen is a pixel-perfect reference for a specific page or component.

## How Stitch Connects to the Project

- **DESIGN.md** lives in the project root. If it doesn't exist, Stitch is not in use — skip all Stitch workflows.
- **Stitch project ID** is specified in the PRD or issue (not in DESIGN.md).

## Workflow: Implementing UI

### 1. Read the Design System

Read `DESIGN.md` first. Every visual decision (colors, fonts, spacing, elevation, component patterns) must follow its rules.

### 2. Get Screen References

If the issue body contains embedded screen HTML, use that as your layout reference. If not, and the project has Stitch MCP tools available, fetch screens using the project ID.

### 3. Implement to Match

For each screen relevant to your work:
1. Use the HTML as your **exact visual target**.
2. Implement the component to match the HTML structure, styling, and layout.
3. Adapt to the project's framework (React, Vue, etc.) but the visual output must match.

### 4. Generate Missing Screens

When implementing a UI component that has **no matching screen**: describe the component in the issue or consult DESIGN.md for patterns. If Stitch MCP tools are available, generate a screen reference.

## Rules

- **DESIGN.md is the styling authority.** All visual decisions come from DESIGN.md.
- **Screen HTML is the layout authority.** The visual output must match exactly.
- **Copy Stitch classes verbatim.** Stitch HTML uses Tailwind classes. Use the exact same classes — do NOT translate to inline styles, CSS modules, or custom CSS. Inline styles lose hover states, opacity modifiers, and responsive breakpoints.
- **Configure Tailwind theme first.** Stitch HTML relies on custom theme colors (e.g., `bg-primary/20`). Ensure the Tailwind config defines all design system colors from DESIGN.md before implementing components.
- **No custom CSS.** Use Tailwind exclusively. If you need a Stitch class that doesn't resolve, fix the Tailwind config — don't replace the class.
- **Don't deviate from the design.** If the design conflicts with requirements, flag it — don't silently "improve" it.

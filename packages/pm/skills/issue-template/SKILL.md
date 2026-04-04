---
name: issue-template
description: Standard format and rules for creating GitHub issues for autonomous agent implementation.
---

# Issue Template Skill

## Issue Template

Every issue MUST follow this exact format:

```
Title: <short descriptive title>

Body:
## Context
<Provide enough detail for an agent to implement THIS slice. Include: user-observable behavior, relevant data model (conceptual), API contracts, technology choices, edge cases. Do NOT include: type definitions, internal state shapes, config blocks, file layout, or framework-specific patterns. Keep under ~60 lines.>

## Acceptance Criteria
<Bulleted checklist describing what the USER sees/experiences. Not implementation details.>
- [ ] User does X and sees Y
- [ ] ...

## Test Plan
<Specific tests that must pass. FIRST test must be a trigger test.>
- [ ] Trigger: <entry-point → observable output, proving the slice is wired end-to-end>
- [ ] Boundary: <describe test through real runtime or route-level render>
- [ ] Unit (only if pure algorithm): <describe algorithmic edge case test>

## Implementation Hints
<Concrete guidance: files to create/modify, key APIs, rough approach. Keep it actionable.>

## Dependencies
<Which previous issues must be complete first, if any>
```

## Creating Issues

- Use `gh issue create` to create each issue.
- Add the `auto-generated` label to every issue (create the label first if it doesn't exist).
- After creating each issue, note its number so you can reference it in subsequent issues' Dependencies sections.

## Rules

- The Context section is CRITICAL — the agent works from this alone. Include behavioral requirements, data model concepts, API contracts, and edge cases inline. Do NOT say "see PRD.md".
- Acceptance criteria must describe user-observable behavior, not code structure.
- Each vertical slice must cross all necessary layers to deliver a working flow.
- **Design is per-slice, not a final pass.** If DESIGN.md exists, every slice that touches UI must implement its screens using the design system.
- **No standalone validation/edge-case issues.** Validation, error handling, and edge cases belong in the slice that introduces the behavior.
- **No standalone polish issues.** Accessibility, responsive layout, and design compliance belong in each slice.

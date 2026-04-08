---
name: issue-template
description: Standard format and rules for creating GitHub issues for autonomous agent implementation.
---

# Issue Template Skill

## When you are writing an issue

Before you read the format below, do the altitude switch. If you have
been in architecture / design mode (discussing the target state with a
user, decomposing a large feature, reasoning about multiple layers),
you must now drop down to slicer mode. In slicer mode:

- You do not write the target state. You write the smallest next
  user-observable change that moves towards it.
- You do not describe every file the feature will eventually touch.
  You describe only the files **this slice** will touch.
- You do not carry forward architectural context that belongs to the
  whole feature. Each slice stands on its own.

Slicer-mode mistakes usually look like: "this issue describes
everything the reader needs to know about how the system will look
after the whole feature is built." Reduce scope until the issue says
"do this one thing and observe that."

## Issue Template

Every issue MUST follow this exact format:

```
Title: <short descriptive title>

Body:
## Context
<Enough detail for an agent to implement THIS slice. Include: user-observable behaviour, relevant data model (conceptual), API contracts, technology choices, edge cases. Do NOT include: type definitions, internal state shapes, config blocks, file layout, or framework-specific patterns. Keep under ~60 lines.>

## Acceptance Criteria
<Bulleted checklist describing what the USER sees/experiences. Not implementation details.>
- [ ] User does X and sees Y
- [ ] ...

## Test Plan
<Specific tests that must pass. FIRST test must be a trigger test.>
- [ ] Trigger: <real production entry point → observable output, proving the slice is wired end-to-end>
- [ ] Boundary: <describe test through real runtime or route-level render>
- [ ] Unit (only if pure algorithm): <describe algorithmic edge case test>

## Implementation Hints
<Concrete guidance: files to create/modify, key APIs, rough approach. Keep it actionable.>

## TDD Rehearsal
<MANDATORY. Enumerate the red-green cycles the implementor will walk through. Count them. If the count exceeds the budget, STOP and split this issue.>

Planned red-green cycles:
1. <behaviour> → `<test file>`
2. <behaviour> → `<test file>`
...

Totals:
- Tests: X / 15
- Files touched (estimate): Y / 10
- Integration sites: Z / 1

If X > 15, Y > 10, or Z > 1: split this issue. Do not submit over budget.

## Dependencies
<Which previous issues must be complete first, if any>
```

## Size budget (HARD limits, not guidelines)

Every issue you create MUST fit all three of the following axes. If
any one is blown, the issue is too big — split it before submitting.

| Axis              | Limit | Why                                                      |
|-------------------|-------|----------------------------------------------------------|
| Tests             | 15    | Matches the implementor's hard test cap. Over 15 = the implementor will truncate work silently. |
| Files touched     | 10    | Above this, reviewers lose track of surface area and typecheck regressions multiply. |
| Integration sites | 1     | "Integration site" = a distinct production call site wired to new code. More than one = separate slices. |

## Integration-point rule

If your Implementation Hints mention wiring a new module into N places
in the codebase (e.g. "call createRunDir from runImplement, runReview,
runArchitecture, and the four PM pipelines"), each place is a
candidate slice. Default behaviour: split into N issues, not one.

You may combine sites into a single issue only when they share a single
user-observable flow that would not ship any value without all of them
wired at once. "Code reuse" is not a valid reason to combine sites.

## TDD rehearsal is a gate, not a section

Do not write the rehearsal as a formality. Actually walk the red-green
cycles in your head:

1. Which behaviour does the first failing test prove?
2. What does the minimal green code look like?
3. Is there a single-file integration point to verify reachability?
4. Repeat until you have covered every acceptance criterion OR you have
   used 15 tests.

If cycle 14 still has uncovered criteria, the issue is too big. Split
it. It is faster to split once than to watch the implementor hit its
budget and stop with half the integration done.

Put the counted cycles in the `## TDD Rehearsal` section of the issue
body so readers (and the implementor) can see the sizing work was
actually done.

## Creating issues

- Use `gh issue create` to create each issue.
- Add the `auto-generated` label to every issue (create the label first if it doesn't exist).
- After creating each issue, note its number so you can reference it in subsequent issues' Dependencies sections.

## Post-draft audit (skill as linter)

After drafting an issue body and BEFORE calling `gh issue create`,
re-read this skill end to end and audit the draft against every rule.
Specifically:

- Is the altitude correct? (slicer mode, not architect mode)
- Is the `## TDD Rehearsal` section present and populated with actual
  counted cycles?
- Does every total fit the budget? (≤15 tests, ≤10 files, ≤1 integration site)
- Does the trigger test name a real production entry point rather
  than a harness or "minimal pipeline"?
- Does the Context section stay under ~60 lines?
- Is every acceptance criterion user-observable, not code structure?

If any rule fails, fix the draft before `gh issue create`. The skill
exists to be used as a linter, not just as a template.

## Rules

- The Context section is CRITICAL — the agent works from this alone. Include behavioural requirements, data model concepts, API contracts, and edge cases inline. Do NOT say "see PRD.md".
- Acceptance criteria must describe user-observable behaviour, not code structure.
- Each vertical slice must cross all necessary layers to deliver a working flow.
- **Trigger tests must name real production entry points.** "A minimal pipeline" or "a small harness" is not a trigger test. The sentence must literally reference the production function, route, or CLI command whose wiring the slice proves.
- **Design is per-slice, not a final pass.** If DESIGN.md exists, every slice that touches UI must implement its screens using the design system.
- **No standalone validation/edge-case issues.** Validation, error handling, and edge cases belong in the slice that introduces the behaviour.
- **No standalone polish issues.** Accessibility, responsive layout, and design compliance belong in each slice.

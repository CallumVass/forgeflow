---
name: tdd
description: Test-driven development with red-green-refactor loop. Use when building features or fixing bugs using TDD, mentions "red-green-refactor", wants integration tests, or asks for test-first development.
---

# Test-Driven Development

## Philosophy

Examples in this skill use framework-neutral pseudocode. Translate test syntax/assertions to the project's language and test runner.

**Core principle**: Test at system boundaries, not internal modules. Mock only what you don't control.

Every system has two testable boundaries:
1. **Server/backend boundary** — test through the real runtime or framework test harness (HTTP handlers, message handlers, queue consumers). Use real storage, real state.
2. **Client/frontend boundary** — test at the route/page level. Mock the network edge (HTTP/WebSocket), but render real components with real stores and real hooks.

Internal modules (stores, hooks, services, helpers) get covered transitively by boundary tests. Don't test them separately — if a store has a bug, a route-level test that exercises the same behavior will catch it.

**Unit test only pure algorithmic functions** where the math matters (rounding, scoring, splitting, validation). Everything else goes through a boundary.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means. The warning sign: your test breaks when you refactor, but behavior hasn't changed.

## Anti-Pattern: Horizontal Slices

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" — treating RED as "write all tests" and GREEN as "write all code."

**Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat. Each test responds to what you learned from the previous cycle.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

## Workflow

### 1. Planning

Before writing any code:

- Confirm what interface changes are needed
- Confirm which behaviors to test (prioritize)
- List the behaviors to test (not implementation steps)

**You can't test everything.** Focus testing effort on critical paths and complex logic, not every possible edge case.

### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior → test fails
GREEN: Write minimal code to pass → test passes
```

This is your tracer bullet — proves the path works end-to-end.

### 3. Incremental Loop

For each remaining behavior:

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

Rules:
- One test at a time
- Only enough code to pass current test
- Don't anticipate future tests
- Keep tests focused on observable behavior

### 4. Refactor

After all tests pass, look for refactor candidates:
- Extract duplication
- Deepen modules (move complexity behind simple interfaces)
- Apply SOLID principles where natural
- Run tests after each refactor step

**Never refactor while RED.** Get to GREEN first.

### 5. Boundary Verification

After all unit tests pass, ask: **"Did any test mock a system boundary?"**

If yes, the mock encodes invisible assumptions about the other side. For each mocked boundary:
1. **Name the assumption**
2. **Verify it** — Write one test that uses the real system to confirm the assumption
3. **If you can't verify it** — Write a contract test

**Rule of thumb**: If your test mocks something, you need another test that doesn't.

## Checklist Per Cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test would survive internal refactor
[ ] Code is minimal for this test
[ ] No speculative features added
```

---
name: prd-quality
description: PRD completeness and quality criteria for evaluating product requirements documents.
---

This skill defines the quality criteria for deciding whether a PRD is complete and implementation-ready.

## Completeness criteria

A PRD is ready only when it satisfies ALL of the following.

### 1. Problem statement and goals
- Clear description of the problem being solved
- Clear users / actors
- Measurable success criteria or goals
- Why this matters

### 2. User stories / use cases
- Each story covers a full flow from trigger to outcome
- Primary happy paths are clear
- Key alternative paths are covered

### 3. Functional requirements
- Detailed enough to implement without more product clarification
- Inputs, outputs, and transformations are described in prose
- API contracts are described in prose, not code
- Data model is described conceptually, not as language-level types

### 4. Non-functional requirements
- Performance expectations where relevant
- Security considerations where relevant
- Reliability / availability where relevant
- Scalability constraints where relevant

### 5. Edge cases and error handling
- Each important flow identifies what can go wrong
- Error states have user-facing behaviour
- Boundary conditions are addressed

### 6. Scope boundaries
- Clear in-scope and out-of-scope boundaries
- No ambiguity about what will and will not be built now

### 6a. Phase structure
- If prior work exists, the PRD should use `## Done` and `## Next`
- `## Done` is accepted context, not under review
- `## Next` is the section being evaluated for implementation readiness

### 7. Vertical-slice readiness
- Requirements are phrased around user-observable flows, not technical layers
- Features can be decomposed into end-to-end slices
- No requirement depends on a fully built layer that does not yet exist

### 8. Implementation clarity
- The PRD says WHAT to build and which technologies matter, not HOW to structure code
- Technology choices are named where they materially affect implementation
- Integration points with existing systems are documented
- Key provider/library choices are named when relevant

### 8a. Greenfield technical direction — CRITICAL
For greenfield or mostly empty projects, the PRD is NOT ready if project-shaping choices are still materially undecided.

When relevant, the PRD should name the chosen:
- project type / app shape
- stack or ecosystem
- app/runtime framework or delivery approach
- testing baseline
- auth/session approach
- persistence approach
- key providers/libraries to use or avoid

For major project-shaping decisions, the PRD may include a brief `## Alternatives Considered` section. Keep it short. The chosen option must be explicit and must remain the source of truth.

Examples of acceptable decision-level statements:
- `App/runtime framework: Phoenix LiveView`
- `Authentication: ASP.NET Core Identity`
- `Testing baseline: ExUnit and Phoenix tests`
- `Preferred provider: Clerk`

### 9. Specification minimalism
- PRD describes behaviour, scope, and decision-level technology choices — not implementation mechanics
- ZERO code blocks allowed
- If a detail would change when swapping to an equivalent library but behaviour stays the same, it is probably implementation detail and should be removed
- Technology choices may name a tool and brief rationale, but should not prescribe code patterns
- Target ~150-200 lines for the whole PRD

## Keep out of the PRD

Do NOT include:
- code blocks
- type/interface definitions
- internal state shapes
- file/directory layout
- framework-specific implementation patterns
- config file contents
- exact scaffold commands

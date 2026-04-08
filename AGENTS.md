# Agents

Project-wide rules for AI coding agents.

## No dynamic imports

Do not use dynamic imports (`await import(...)` or `import(...)`) in production code. Use static `import` statements at the top of the file instead.

Dynamic imports in test files are acceptable only when required by the test framework (e.g. `vi.mock` with `importOriginal`).

## Pipelines use the `PipelineContext` seam

Pipelines must NOT import `runAgent`, `exec`, or `execSafe` directly from
`@callumvass/forgeflow-shared`. They receive these as fields on
`PipelineContext`:

- `pctx.runAgentFn(agent, prompt, opts)` — spawn a forgeflow sub-agent
- `pctx.execFn(cmd, cwd)` — run a shell command (throws on non-zero)
- `pctx.execSafeFn(cmd, cwd)` — run a shell command (returns "" on failure)

Defaults are wired at the extension boundary (`packages/dev/src/index.ts`,
`packages/pm/src/index.ts`) by `toPipelineContext`. Tests inject spies via
`mockPipelineContext({ runAgentFn, execFn, execSafeFn })`.

**The only files allowed to import from `@callumvass/forgeflow-shared/agent`
or `@callumvass/forgeflow-shared/exec` are inside `packages/shared/src/`.**
Anything in `packages/dev/src/pipelines`, `packages/pm/src/pipelines`, or
`packages/dev/src/utils` that grabs `runAgent` / `exec` / `execSafe` directly
should be migrated to read from `pctx` instead.

The project `check` script runs a grep that fails CI on regressions — see
`scripts/check-pipeline-seams.sh`.

New pipeline option types must NOT declare `runAgentFn?: RunAgentFn` or
`execFn?: ExecFn` — the seam already lives on `PipelineContext`.

## Shared-only feature commits must touch a consumer package

`release-please` is configured for `packages/pm` and `packages/dev` only —
`packages/shared` is intentionally **not** a published npm package and is
not tracked by `release-please-config.json`. release-please attributes
commits to packages by changed-file path, so a `feat:` or `fix:` whose
diff lives entirely under `packages/shared/` will produce **no version
bump** and the new behaviour will never reach users of
`@callumvass/forgeflow-dev` / `@callumvass/forgeflow-pm`.

When adding a `feat:` or `fix:` to `packages/shared`, the **same commit**
must also touch a real file under `packages/dev/` and/or `packages/pm/`
that reflects the change. Acceptable touches:

- Documenting the new capability in `packages/dev/README.md` or
  `packages/pm/README.md` (preferred — user-facing).
- Updating an agent prompt under `packages/dev/agents/` or
  `packages/pm/agents/` that depends on the new behaviour.
- Wiring the new shared API into a pipeline under
  `packages/dev/src/pipelines/` or `packages/pm/src/pipelines/`.

Do **not** create empty commits, comment-only churn, or whitespace edits
to satisfy this rule — release-please will pick them up but the diff is
noise. If a shared change has genuinely no consumer-visible effect, it
should not be `feat:`/`fix:` in the first place; use `refactor:`,
`chore:`, or `test:`.

For a retroactive bump after a shared-only `feat:` has already merged,
add a follow-up PR that documents the feature in the consumer README
(this is what triggered the v0.14.0 release for the per-stage model
overrides feature).

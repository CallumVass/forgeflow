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

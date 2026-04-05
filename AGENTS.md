# Agents

Project-wide rules for AI coding agents.

## No dynamic imports

Do not use dynamic imports (`await import(...)` or `import(...)`) in production code. Use static `import` statements at the top of the file instead.

Dynamic imports in test files are acceptable only when required by the test framework (e.g. `vi.mock` with `importOriginal`).

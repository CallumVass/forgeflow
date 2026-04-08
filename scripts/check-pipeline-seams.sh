#!/usr/bin/env bash
#
# Enforce the rule from AGENTS.md: pipelines and pipeline-adjacent utils
# must not import `runAgent` / `exec` / `execSafe` directly. They receive
# these as fields on `PipelineContext`. The only permitted consumers are
# inside `packages/shared/src/`.
#
# Run as part of `npm run check`. Exits non-zero (and prints offenders)
# if any forbidden import is detected.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

forbid() {
  local pattern="$1"
  shift
  local hits
  hits=$(grep -rn "$pattern" "$@" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "✘ Forbidden imports detected:"
    echo "$hits"
    return 1
  fi
}

failed=0

forbid 'from "@callumvass/forgeflow-shared/agent"' \
  packages/dev/src/pipelines \
  packages/pm/src/pipelines \
  packages/dev/src/utils || failed=1

forbid 'from "@callumvass/forgeflow-shared/exec"' \
  packages/dev/src/pipelines \
  packages/pm/src/pipelines \
  packages/dev/src/utils || failed=1

if [ "$failed" -ne 0 ]; then
  echo
  echo "Pipelines must read runAgent / exec / execSafe from PipelineContext."
  echo "See AGENTS.md › 'Pipelines use the PipelineContext seam' for details."
  exit 1
fi

echo "✓ pipeline seam check passed"

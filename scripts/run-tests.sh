#!/usr/bin/env bash
# Runs every standalone test in tests/ (and tests/runtime/) under plain
# Node -- no bundler, no test framework, consistent with the app's own
# no-build-step approach. Each file manages its own pass/fail counting
# and exit code; this script just runs them all and reports which failed.
set -u
cd "$(dirname "$0")/.."

failed=()
for f in tests/*.test.mjs tests/runtime/*.test.mjs; do
  echo "=== $f ==="
  if ! node "$f"; then
    failed+=("$f")
  fi
  echo
done

if [ ${#failed[@]} -ne 0 ]; then
  echo "FAILED:"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
echo "All test files passed."

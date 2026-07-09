#!/bin/bash
# Wrapper for golangci-lint.
#
# The previous version ran `golangci-lint run 2>&1 || true` and only failed when
# the output contained a "file.go:LINE:COL:" pattern. That meant *configuration*
# and *startup* errors — an unparseable config, an unknown linter, a missing
# binary — printed "Go linting passed" and exited 0. Go linting was silently a
# no-op for as long as those errors existed.
#
# Now: startup/config failures are always fatal. Lint findings are reported and
# returned as exit 1; the caller (see .github/workflows/ci.yml) decides whether
# findings block the build.

set -uo pipefail

export PATH="$PATH:$(go env GOPATH)/bin"

if ! command -v golangci-lint >/dev/null 2>&1; then
    echo "error: golangci-lint is not on PATH" >&2
    exit 1
fi

output=$(golangci-lint run 2>&1)
status=$?

if [ -n "$output" ]; then
    echo "$output"
fi

case "$status" in
    0)
        echo "✓ Go linting passed"
        exit 0
        ;;
    1)
        echo ""
        echo "✗ golangci-lint reported findings"
        exit 1
        ;;
    *)
        # 2+ means golangci-lint itself failed: bad config, unknown linter,
        # compile error. Never mistake this for a clean run.
        echo ""
        echo "✗ golangci-lint failed to run (exit ${status}) - configuration or" \
             "toolchain error, not a lint finding" >&2
        exit 1
        ;;
esac

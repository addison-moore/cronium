#!/bin/sh
# Builds the helper binaries the runner embeds into internal/helpers/binaries.
# They are generated, not tracked, so every build of the runner runs this first.
# `go test`, `go vet` and the like do not need them: use `-tags nohelpers`.
#
# Usage: ./build-helpers.sh [arch...]   (default: amd64 arm64)
#
# The helpers import the package that embeds them, so they are built with the
# nohelpers tag. Without it, each one would need the others to already exist, and
# would carry a copy of them.
#
# POSIX sh: the orchestrator image builds in an Alpine stage with no bash.
set -eu

cd "$(dirname "$0")"

output_dir=internal/helpers/binaries
mkdir -p "$output_dir"

[ "$#" -gt 0 ] || set -- amd64 arm64

for arch in "$@"; do
    for dir in cmd/helpers/*/; do
        helper=$(basename "$dir")
        CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build \
            -tags nohelpers \
            -trimpath \
            -ldflags="-s -w" \
            -o "$output_dir/linux_${arch}_cronium.${helper}" \
            "./$dir"
    done
done

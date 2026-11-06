//go:build nohelpers || !linux || !(amd64 || arm64)

package helpers

import (
	"fmt"
	"runtime"
)

// Embedded reports whether this build carries helper binaries. This one does not:
// it exists so `go test`, `go vet` and static analysis compile without generating
// them, and on hosts the runner never ships to. The runner it produces cannot run
// a job, because SetupHelpers fails at extraction.
const Embedded = false

// GetHelperBinary always fails in a build without embedded helpers.
func GetHelperBinary(name string) ([]byte, error) {
	return nil, fmt.Errorf("helper binary not found for platform %s_%s: %s (this build embeds no helpers)", runtime.GOOS, runtime.GOARCH, name)
}

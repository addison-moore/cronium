//go:build !nohelpers && linux && (amd64 || arm64)

package helpers

import "fmt"

// Embedded reports whether this build carries helper binaries.
const Embedded = true

// GetHelperBinary returns the embedded helper binary for this platform.
func GetHelperBinary(name string) ([]byte, error) {
	data, err := embeddedHelpers.ReadFile("binaries/" + embeddedPlatform + "_cronium." + name)
	if err != nil {
		return nil, fmt.Errorf("helper binary not found for platform %s: %s", embeddedPlatform, name)
	}
	return data, nil
}

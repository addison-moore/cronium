//go:build linux_arm64_only
// +build linux_arm64_only

package helpers

import (
    _ "embed"
    "fmt"
    "runtime"
)

// Embedded helper binaries for Linux ARM64 only
var (
    //go:embed binaries/linux_arm64_cronium.input
    linux_arm64_input []byte

    //go:embed binaries/linux_arm64_cronium.output
    linux_arm64_output []byte

    //go:embed binaries/linux_arm64_cronium.getVariable
    linux_arm64_getVariable []byte

    //go:embed binaries/linux_arm64_cronium.setVariable
    linux_arm64_setVariable []byte

    //go:embed binaries/linux_arm64_cronium.event
    linux_arm64_event []byte
)

// GetHelperBinary returns the embedded helper binary for linux/arm64
func GetHelperBinary(name string) ([]byte, error) {
    if runtime.GOOS != "linux" || runtime.GOARCH != "arm64" {
        return nil, fmt.Errorf("embedded helpers are only for linux/arm64, current: %s/%s", runtime.GOOS, runtime.GOARCH)
    }

    switch name {
    case "input":
        return linux_arm64_input, nil
    case "output":
        return linux_arm64_output, nil
    case "getVariable":
        return linux_arm64_getVariable, nil
    case "setVariable":
        return linux_arm64_setVariable, nil
    case "event":
        return linux_arm64_event, nil
    default:
        return nil, fmt.Errorf("unknown helper: %s", name)
    }
}

// ExtractHelpers extracts embedded helpers to the filesystem
func ExtractHelpers(dir string) error {
    helpers := map[string][]byte{
        "cronium.input":       linux_arm64_input,
        "cronium.output":      linux_arm64_output,
        "cronium.getVariable": linux_arm64_getVariable,
        "cronium.setVariable": linux_arm64_setVariable,
        "cronium.event":       linux_arm64_event,
    }

    return extractHelperFiles(dir, helpers)
}

// ExtractAllHelpers extracts all helper binaries to a directory
func ExtractAllHelpers(targetDir string) error {
    return ExtractHelpers(targetDir)
}
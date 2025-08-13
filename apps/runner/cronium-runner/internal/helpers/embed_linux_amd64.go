//go:build linux_amd64_only
// +build linux_amd64_only

package helpers

import (
    _ "embed"
    "fmt"
    "runtime"
)

// Embedded helper binaries for Linux AMD64 only
var (
    //go:embed binaries/linux_amd64_cronium.input
    linux_amd64_input []byte

    //go:embed binaries/linux_amd64_cronium.output
    linux_amd64_output []byte

    //go:embed binaries/linux_amd64_cronium.getVariable
    linux_amd64_getVariable []byte

    //go:embed binaries/linux_amd64_cronium.setVariable
    linux_amd64_setVariable []byte

    //go:embed binaries/linux_amd64_cronium.event
    linux_amd64_event []byte
)

// GetHelperBinary returns the embedded helper binary for linux/amd64
func GetHelperBinary(name string) ([]byte, error) {
    if runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
        return nil, fmt.Errorf("embedded helpers are only for linux/amd64, current: %s/%s", runtime.GOOS, runtime.GOARCH)
    }

    switch name {
    case "input":
        return linux_amd64_input, nil
    case "output":
        return linux_amd64_output, nil
    case "getVariable":
        return linux_amd64_getVariable, nil
    case "setVariable":
        return linux_amd64_setVariable, nil
    case "event":
        return linux_amd64_event, nil
    default:
        return nil, fmt.Errorf("unknown helper: %s", name)
    }
}

// ExtractHelpers extracts embedded helpers to the filesystem
func ExtractHelpers(dir string) error {
    helpers := map[string][]byte{
        "cronium.input":       linux_amd64_input,
        "cronium.output":      linux_amd64_output,
        "cronium.getVariable": linux_amd64_getVariable,
        "cronium.setVariable": linux_amd64_setVariable,
        "cronium.event":       linux_amd64_event,
    }

    return extractHelperFiles(dir, helpers)
}

// ExtractAllHelpers extracts all helper binaries to a directory
func ExtractAllHelpers(targetDir string) error {
    return ExtractHelpers(targetDir)
}
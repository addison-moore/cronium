package helpers

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// embeddedHelpersAvailable reports whether the default embed.go build can
// serve helper binaries for the current platform. Only linux/amd64 and
// linux/arm64 binaries are embedded; on macOS GetHelperBinary fails by design
// (the runner ships to Linux servers).
func embeddedHelpersAvailable() bool {
	return runtime.GOOS == "linux" && (runtime.GOARCH == "amd64" || runtime.GOARCH == "arm64")
}

func TestExtractHelperFilesWritesExecutables(t *testing.T) {
	// Nested path: extractHelperFiles must create the directory.
	dir := filepath.Join(t.TempDir(), "nested", "bin")
	files := map[string][]byte{
		"cronium.input":  []byte("#!/bin/sh\necho input\n"),
		"cronium.output": []byte{0x7f, 'E', 'L', 'F'},
		"cronium.empty":  {},
	}

	if err := extractHelperFiles(dir, files); err != nil {
		t.Fatalf("extractHelperFiles failed: %v", err)
	}

	for name, want := range files {
		path := filepath.Join(dir, name)
		if len(want) == 0 {
			// Empty helpers are skipped, not written.
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Errorf("expected empty helper %s to be skipped, stat err: %v", name, err)
			}
			continue
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("failed to read %s: %v", name, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s content mismatch", name)
		}
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("failed to stat %s: %v", name, err)
		}
		if info.Mode().Perm()&0o100 == 0 {
			t.Errorf("%s is not executable (mode %v)", name, info.Mode())
		}
	}
}

func TestExtractHelperFilesDirCreationError(t *testing.T) {
	base := t.TempDir()
	blocker := filepath.Join(base, "file")
	if err := os.WriteFile(blocker, []byte("x"), 0o644); err != nil {
		t.Fatalf("failed to write blocker: %v", err)
	}
	err := extractHelperFiles(filepath.Join(blocker, "bin"), map[string][]byte{"h": []byte("x")})
	if err == nil || !strings.Contains(err.Error(), "failed to create helpers directory") {
		t.Fatalf("expected directory creation error, got: %v", err)
	}
}

func TestGetHelperBinaryPlatformSelection(t *testing.T) {
	data, err := GetHelperBinary("input")
	if embeddedHelpersAvailable() {
		if err != nil {
			t.Fatalf("expected embedded helper on %s/%s, got: %v", runtime.GOOS, runtime.GOARCH, err)
		}
		if len(data) == 0 {
			t.Fatal("embedded helper binary is empty")
		}
	} else {
		// Documented limitation: only Linux helper binaries are embedded, so
		// selection must fail cleanly on other hosts (e.g. darwin).
		if err == nil {
			t.Fatalf("expected error on %s/%s where no helpers are embedded", runtime.GOOS, runtime.GOARCH)
		}
		if !strings.Contains(err.Error(), "helper binary not found for platform") {
			t.Errorf("error = %q, want platform-not-found message", err.Error())
		}
	}
}

func TestGetHelperBinaryUnknownName(t *testing.T) {
	if _, err := GetHelperBinary("bogus"); err == nil {
		t.Fatal("expected error for unknown helper name")
	}
}

func TestExtractAllHelpers(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bin")
	err := ExtractAllHelpers(dir)

	if !embeddedHelpersAvailable() {
		// On non-Linux hosts extraction must fail (nothing embedded); the
		// Linux round-trip below runs in CI.
		if err == nil {
			t.Fatalf("expected ExtractAllHelpers to fail on %s/%s", runtime.GOOS, runtime.GOARCH)
		}
		if !strings.Contains(err.Error(), "failed to extract") {
			t.Errorf("error = %q, want extract failure", err.Error())
		}
		return
	}

	if err != nil {
		t.Fatalf("ExtractAllHelpers failed: %v", err)
	}
	for _, name := range helperNames {
		path := filepath.Join(dir, "cronium."+name)
		info, statErr := os.Stat(path)
		if statErr != nil {
			t.Fatalf("expected helper %s to be extracted: %v", name, statErr)
		}
		if info.Size() == 0 {
			t.Errorf("helper %s is empty", name)
		}
		if info.Mode().Perm()&0o100 == 0 {
			t.Errorf("helper %s is not executable (mode %v)", name, info.Mode())
		}
	}
}

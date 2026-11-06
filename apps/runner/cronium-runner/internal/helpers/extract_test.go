package helpers

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

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
	if Embedded {
		if err != nil {
			t.Fatalf("expected an embedded helper, got: %v", err)
		}
		if len(data) == 0 {
			t.Fatal("embedded helper binary is empty")
		}
	} else {
		// A build without helpers fails cleanly rather than extracting nothing.
		if err == nil {
			t.Fatal("expected an error from a build with no helpers embedded")
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

	if !Embedded {
		// Nothing to extract. CI runs the round trip below after generating the
		// helpers, without the nohelpers tag.
		if err == nil {
			t.Fatal("expected ExtractAllHelpers to fail with no helpers embedded")
		}
		if !strings.Contains(err.Error(), "failed to extract") {
			t.Errorf("error = %q, want extract failure", err.Error())
		}
		return
	}

	if err != nil {
		t.Fatalf("ExtractAllHelpers failed: %v", err)
	}
	for _, name := range HelperNames {
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

// HelperNames, cmd/helpers and the go:embed lists have to agree. Only one embed
// file compiles on any host, and none with -tags nohelpers, so read them as text
// to catch a helper missing from either before a release build does.
func TestHelperListsAgree(t *testing.T) {
	entries, err := os.ReadDir("../../cmd/helpers")
	if err != nil {
		t.Fatalf("failed to list cmd/helpers: %v", err)
	}
	var dirs []string
	for _, entry := range entries {
		if entry.IsDir() {
			dirs = append(dirs, entry.Name())
		}
	}
	sorted := slices.Sorted(slices.Values(HelperNames))
	if !slices.Equal(dirs, sorted) {
		t.Errorf("cmd/helpers = %v, HelperNames = %v", dirs, sorted)
	}

	for file, platform := range map[string]string{
		"embed_linux_amd64.go": "linux_amd64",
		"embed_linux_arm64.go": "linux_arm64",
	} {
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("failed to read %s: %v", file, err)
		}
		if got, want := strings.Count(string(source), "//go:embed "), len(HelperNames); got != want {
			t.Errorf("%s embeds %d files, want %d", file, got, want)
		}
		for _, name := range HelperNames {
			if !strings.Contains(string(source), "//go:embed binaries/"+platform+"_cronium."+name+"\n") {
				t.Errorf("%s does not embed %s", file, name)
			}
		}
	}
}

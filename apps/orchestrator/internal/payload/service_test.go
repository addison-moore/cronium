package payload

import (
	"archive/tar"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// manifestEnvironment reads a payload's environment the way the runner does: with
// yaml.v3, where the orchestrator writes it with yaml.v2, which folds long lines.
func manifestEnvironment(t *testing.T, payloadPath string) map[string]string {
	t.Helper()
	file, err := os.Open(payloadPath)
	if err != nil {
		t.Fatalf("open payload: %v", err)
	}
	defer file.Close()
	archive, err := gzip.NewReader(file)
	if err != nil {
		t.Fatalf("read payload: %v", err)
	}
	reader := tar.NewReader(archive)
	for {
		header, err := reader.Next()
		if err == io.EOF {
			t.Fatal("payload has no manifest")
		}
		if err != nil {
			t.Fatalf("read payload: %v", err)
		}
		if filepath.Base(header.Name) != "manifest.yaml" {
			continue
		}
		content, err := io.ReadAll(reader)
		if err != nil {
			t.Fatalf("read manifest: %v", err)
		}
		var manifest struct {
			Environment map[string]string `yaml:"environment"`
		}
		if err := yaml.Unmarshal(content, &manifest); err != nil {
			t.Fatalf("parse manifest: %v", err)
		}
		return manifest.Environment
	}
}

func TestLongEnvironmentValuesSurviveTheManifest(t *testing.T) {
	// 128,000 bytes is the most the app accepts for one value.
	values := map[string]string{
		"JWT":            "eyJhbGciOiJSUzI1NiJ9." + strings.Repeat("eyJzdWIiOiIxIn0", 300) + ".c2ln",
		"NO_SPACES":      strings.Repeat("0123456789", 12_800),
		"FOLDABLE":       strings.Repeat("0123456789 ", 11_636),
		"RUNS_OF_SPACES": strings.Repeat("word  word   word    ", 300),
		"EDGE_SPACES":    "   " + strings.Repeat("x y ", 300) + "   ",
		"PEM":            "-----BEGIN PRIVATE KEY-----\n" + strings.Repeat("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n", 80) + "-----END PRIVATE KEY-----\n",
		"CRLF":           strings.Repeat("a line of text that goes on for a while\r\n", 100),
		"JSON":           `{"type": "service_account", "key": "line one\nline two", "note": "a: b # c"}` + strings.Repeat(" ", 100) + `{"x": []}`,
		"TABS":           strings.Repeat("a\tb\t\tc ", 300),
		"UNICODE":        strings.Repeat("日本語 テキスト é🙂 ", 200),
		"LINE_SEPARATOR": strings.Repeat("a\u00a0b\u2028c\u0085d ", 100),
		"LOOKS_BOOLEAN":  "true",
		"LOOKS_NUMERIC":  "0123",
		"LOOKS_NULL":     "null",
	}

	service := NewService(t.TempDir())
	payloadPath, err := service.CreatePayload(&PayloadData{
		JobID:         "job-1",
		ExecutionID:   "exec-1",
		ScriptContent: "echo hi",
		ScriptType:    "BASH",
		Environment:   values,
	})
	if err != nil {
		t.Fatalf("CreatePayload: %v", err)
	}

	environment := manifestEnvironment(t, payloadPath)
	for key, want := range values {
		got, present := environment[key]
		if !present {
			t.Errorf("%s is missing from the manifest", key)
		} else if got != want {
			t.Errorf("%s changed on the way through the manifest: %d bytes in, %d out", key, len(want), len(got))
		}
	}
}

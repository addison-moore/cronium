package helpers

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const fakeHelperDir = "/opt/cronium/.cronium/bin"

var helperNames = []string{"input", "output", "getVariable", "setVariable", "event"}

func TestGenerateDiscoveryScriptContents(t *testing.T) {
	script := GenerateDiscoveryScript(fakeHelperDir)

	if !strings.Contains(script, `export CRONIUM_HELPERS_DIR="`+fakeHelperDir+`"`) {
		t.Error("bash discovery script does not export CRONIUM_HELPERS_DIR with the helper dir")
	}
	for _, name := range helperNames {
		if !strings.Contains(script, "cronium."+name+"() {") {
			t.Errorf("bash discovery script missing dotted function cronium.%s", name)
		}
		if !strings.Contains(script, "export -f cronium."+name) {
			t.Errorf("bash discovery script missing export -f cronium.%s", name)
		}
	}
	// Canonical container-SDK snake_case aliases must exist so scripts written
	// to the documented interface run unchanged locally and remotely.
	for _, alias := range []string{
		"cronium_input", "cronium_output", "cronium_get_variable",
		"cronium_set_variable", "cronium_event",
	} {
		if !strings.Contains(script, alias+"()") {
			t.Errorf("bash discovery script missing snake_case alias %s", alias)
		}
		if !strings.Contains(script, "export -f "+alias) {
			t.Errorf("bash discovery script missing export -f %s", alias)
		}
	}
}

func TestGeneratePythonDiscoveryContents(t *testing.T) {
	script := GeneratePythonDiscovery(fakeHelperDir)

	for _, want := range []string{
		`CRONIUM_HELPERS_DIR = "` + fakeHelperDir + `"`,
		"class cronium:",
		"def input():",
		"def output(data):",
		"def getVariable(key):",
		"def setVariable(key, value):",
		"def event():",
		"cronium.get_variable = cronium.getVariable",
		"cronium.set_variable = cronium.setVariable",
		"builtins.cronium = cronium",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("python discovery script missing %q", want)
		}
	}
}

func TestGenerateNodeDiscoveryContents(t *testing.T) {
	script := GenerateNodeDiscovery(fakeHelperDir)

	for _, want := range []string{
		"const CRONIUM_HELPERS_DIR = '" + fakeHelperDir + "'",
		"global.cronium = {",
		"input: function()",
		"output: function(data)",
		"getVariable: function(key)",
		"setVariable: function(key, value)",
		"event: function()",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("node discovery script missing %q", want)
		}
	}
}

// newDiscoveryWorkDir creates a work dir with the .cronium directory
// SetupDiscovery expects to already exist (the executor creates it in
// SetupHelpers before calling SetupDiscovery).
func newDiscoveryWorkDir(t *testing.T) string {
	t.Helper()
	workDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workDir, ".cronium"), 0o755); err != nil {
		t.Fatalf("failed to create .cronium dir: %v", err)
	}
	return workDir
}

func TestSetupDiscoveryPerInterpreter(t *testing.T) {
	cases := []struct {
		interpreter string
		file        string
		wantExec    bool
	}{
		{"BASH", "discovery.sh", true},
		{"bash", "discovery.sh", true},
		{"PYTHON", "discovery.py", true},
		{"python", "discovery.py", true},
		{"NODE", "discovery.js", false},
		{"node", "discovery.js", false},
	}
	for _, tc := range cases {
		t.Run(tc.interpreter, func(t *testing.T) {
			workDir := newDiscoveryWorkDir(t)
			if err := SetupDiscovery(workDir, tc.interpreter); err != nil {
				t.Fatalf("SetupDiscovery(%q) failed: %v", tc.interpreter, err)
			}
			path := filepath.Join(workDir, ".cronium", tc.file)
			info, err := os.Stat(path)
			if err != nil {
				t.Fatalf("expected %s to be written: %v", tc.file, err)
			}
			if execBit := info.Mode().Perm()&0o100 != 0; execBit != tc.wantExec {
				t.Errorf("%s exec bit = %v, want %v (mode %v)", tc.file, execBit, tc.wantExec, info.Mode())
			}
			content, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("failed to read %s: %v", tc.file, err)
			}
			helpersDir := filepath.Join(workDir, ".cronium", "bin")
			if !strings.Contains(string(content), helpersDir) {
				t.Errorf("%s does not reference the helpers dir %s", tc.file, helpersDir)
			}
		})
	}
}

// Pin actual behavior: an unrecognized interpreter is a silent no-op (no file,
// no error). The executor rejects unsupported interpreters earlier.
func TestSetupDiscoveryUnknownInterpreterIsNoop(t *testing.T) {
	workDir := newDiscoveryWorkDir(t)
	if err := SetupDiscovery(workDir, "RUBY"); err != nil {
		t.Fatalf("expected nil error for unknown interpreter, got: %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(workDir, ".cronium"))
	if err != nil {
		t.Fatalf("failed to list .cronium: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected no discovery files, found %d entries", len(entries))
	}
}

// SetupDiscovery does not create the .cronium directory itself; pin the
// contract that the caller must have created it.
func TestSetupDiscoveryRequiresCroniumDir(t *testing.T) {
	err := SetupDiscovery(t.TempDir(), "BASH")
	if err == nil || !strings.Contains(err.Error(), "failed to write bash discovery script") {
		t.Fatalf("expected write error without .cronium dir, got: %v", err)
	}
}

// Functional check: source the generated bash discovery script and call both
// the dotted functions and the snake_case aliases against stub helper
// "binaries" (shell scripts), verifying arguments pass through.
func TestBashDiscoveryScriptFunctionsWork(t *testing.T) {
	bashPath, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("bash not available on this host; the generated discovery script targets bash")
	}

	workDir := newDiscoveryWorkDir(t)
	binDir := filepath.Join(workDir, ".cronium", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("failed to create bin dir: %v", err)
	}
	stubs := map[string]string{
		"cronium.input":       "#!/bin/sh\necho '{\"fake\":\"input\"}'\n",
		"cronium.getVariable": "#!/bin/sh\necho \"getVariable:$1\"\n",
	}
	for name, content := range stubs {
		if err := os.WriteFile(filepath.Join(binDir, name), []byte(content), 0o755); err != nil {
			t.Fatalf("failed to write stub %s: %v", name, err)
		}
	}
	if err := SetupDiscovery(workDir, "BASH"); err != nil {
		t.Fatalf("SetupDiscovery failed: %v", err)
	}

	script := `source "` + filepath.Join(workDir, ".cronium", "discovery.sh") + `"
cronium.input
cronium_input
cronium.getVariable mykey
cronium_get_variable otherkey`
	out, err := exec.Command(bashPath, "-c", script).CombinedOutput()
	if err != nil {
		t.Fatalf("bash discovery functions failed: %v\noutput: %s", err, out)
	}
	for _, want := range []string{
		`{"fake":"input"}`, "getVariable:mykey", "getVariable:otherkey",
	} {
		if !strings.Contains(string(out), want) {
			t.Errorf("output missing %q:\n%s", want, out)
		}
	}
}

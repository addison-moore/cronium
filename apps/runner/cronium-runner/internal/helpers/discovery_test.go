package helpers

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const fakeHelperDir = "/opt/cronium/.cronium/bin"

// sdkPath locates a file in the container SDK, the reference for the runner's.
func sdkPath(parts ...string) string {
	return filepath.Join(append([]string{"..", "..", "..", "..", "runtime", "runtime-helpers"}, parts...)...)
}

func TestGenerateDiscoveryScriptContents(t *testing.T) {
	script := GenerateDiscoveryScript(fakeHelperDir)

	if !strings.Contains(script, `export CRONIUM_HELPERS_DIR="`+fakeHelperDir+`"`) {
		t.Error("bash discovery script does not export CRONIUM_HELPERS_DIR with the helper dir")
	}
	if strings.Contains(script, helpersDirPlaceholder) {
		t.Error("bash discovery script still has its placeholder")
	}
	for _, name := range []string{"input", "output", "getVariable", "setVariable", "setCondition", "event"} {
		if !strings.Contains(script, "cronium."+name+"() {") {
			t.Errorf("bash discovery script missing dotted function cronium.%s", name)
		}
	}
}

// exportedFunctions returns the names in a script's "export -f" lines.
func exportedFunctions(script string) map[string]bool {
	names := make(map[string]bool)
	for _, line := range strings.Split(script, "\n") {
		if rest, ok := strings.CutPrefix(line, "export -f "); ok {
			for _, name := range strings.Fields(rest) {
				names[name] = true
			}
		}
	}
	return names
}

// Every function the container's bash SDK offers a script exists on the runner
// too, defined and exported, so a new one cannot be added to only one of them.
func TestBashDiscoveryCoversTheContainerSDK(t *testing.T) {
	sdk, err := os.ReadFile(sdkPath("bash", "cronium.sh"))
	if err != nil {
		t.Fatalf("failed to read the container SDK: %v", err)
	}
	script := GenerateDiscoveryScript(fakeHelperDir)
	exported := exportedFunctions(script)

	checked := 0
	for name := range exportedFunctions(string(sdk)) {
		if strings.HasPrefix(name, "_") {
			continue // the SDK's HTTP plumbing, which the helper binaries replace
		}
		checked++
		if !strings.Contains(script, name+"() {") {
			t.Errorf("runner discovery does not define %s", name)
		}
		if !exported[name] {
			t.Errorf("runner discovery does not export %s", name)
		}
	}
	if checked < 10 {
		t.Errorf("found only %d functions in the container SDK; has its format changed?", checked)
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
		"def setCondition(condition):",
		"def event():",
		"def execute_tool_action(tool, action, config):",
		"def send_email(to, subject, body, **kwargs):",
		"def send_slack_message(channel, text, **kwargs):",
		"def send_discord_message(channel_id, content, **kwargs):",
		"cronium.get_variable = cronium.getVariable",
		"cronium.set_variable = cronium.setVariable",
		"cronium.set_condition = cronium.setCondition",
		`sys.modules["cronium"] = cronium`,
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
		"global.cronium = module.exports",
		"async input()",
		"async output(data)",
		"async getVariable(key)",
		"async setVariable(key, value)",
		"async setCondition(condition)",
		"async event()",
		"async executeToolAction(tool, action, config)",
		"async sendEmail({",
		"async sendSlackMessage({",
		"async sendDiscordMessage({",
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
		"cronium.input":        "#!/bin/sh\necho '{\"fake\":\"input\"}'\n",
		"cronium.getVariable":  "#!/bin/sh\necho \"getVariable:$*\"\n",
		"cronium.setCondition": "#!/bin/sh\necho \"setCondition:$*\"\n",
		"cronium.event":        "#!/bin/sh\necho \"event:$*\"\n",
		"cronium.toolAction":   "#!/bin/sh\necho \"toolAction:$*:$(cat)\"\n",
		// Like the real binary, these read their value from stdin.
		"cronium.output":      "#!/bin/sh\necho \"output:$(cat)\"\n",
		"cronium.setVariable": "#!/bin/sh\necho \"setVariable:$*:$(cat)\"\n",
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
cronium_get_variable otherkey
cronium_output '{"via":"arg"}'
cronium.output 'two words'
echo '{"via":"stdin"}' | cronium_output
cronium_set_variable K '{"a":1}'
echo x | cronium_set_variable K2 ''
echo '{"via":"stdin"}' | cronium_set_variable K3
cronium_set_condition yes
cronium.setCondition no
cronium_event
cronium_event_field event.name
cronium_execute_tool_action sql run_query '{"q":1}' </dev/null
cronium_send_email a@x.io Subject Body --html </dev/null`
	out, err := exec.Command(bashPath, "-c", script).CombinedOutput()
	if err != nil {
		t.Fatalf("bash discovery functions failed: %v\noutput: %s", err, out)
	}
	for _, want := range []string{
		`{"fake":"input"}`, "getVariable:mykey", "getVariable:--raw otherkey",
		`output:{"via":"arg"}`, "output:two words", `output:{"via":"stdin"}`,
		`setVariable:K:{"a":1}`, "setVariable:K2:\n", `setVariable:K3:{"via":"stdin"}`,
		"setCondition:yes", "setCondition:no",
		"event:\n", "event:--field event.name",
		`toolAction:execute sql run_query:{"q":1}`,
		"toolAction:email a@x.io Subject Body --html:",
	} {
		if !strings.Contains(string(out), want) {
			t.Errorf("output missing %q:\n%s", want, out)
		}
	}
}

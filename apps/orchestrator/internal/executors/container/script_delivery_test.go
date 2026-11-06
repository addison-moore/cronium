package container

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/moby/moby/client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// maxArgBytes is Linux's limit on one exec argument, counting its NUL.
const maxArgBytes = 131072

func TestScriptSource_PutsTheLoaderBeforeTheScript(t *testing.T) {
	const content = "echo 'user script'\n\n"
	tests := []struct {
		name       string
		scriptType types.ScriptType
		loader     string
	}{
		{"bash", types.ScriptTypeBash, "source /usr/local/bin/cronium.sh 2>/dev/null || true\n"},
		{"python", types.ScriptTypePython, "import cronium\n"},
		{"node", types.ScriptTypeNode, "globalThis.cronium = require('cronium'); //# sourceURL=[eval]\n"},
		{"unknown falls back to bash", "RUBY", "source /usr/local/bin/cronium.sh 2>/dev/null || true\n"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			source := scriptSource(&types.Script{Type: tc.scriptType, Content: content})
			assert.Equal(t, tc.loader+content, string(source))
		})
	}
}

func TestBuildCommand_HoldsNoPartOfTheScript(t *testing.T) {
	e := newUnitExecutor()
	const marker = "user-script-marker"
	content := marker + strings.Repeat("x", 3*maxArgBytes)

	tests := []struct {
		name       string
		scriptType types.ScriptType
		wantArgv   []string
	}{
		{"bash", types.ScriptTypeBash, []string{"/bin/bash", "-c"}},
		{"python", types.ScriptTypePython, []string{"python", "-c"}},
		{"node", types.ScriptTypeNode, []string{"node", "-e"}},
		{"unknown falls back to bash", "RUBY", []string{"/bin/bash", "-c"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cmd := e.buildCommand(&types.Script{Type: tc.scriptType, Content: content})
			require.Len(t, cmd, 3)
			assert.Equal(t, tc.wantArgv, cmd[:2])
			assert.NotContains(t, cmd[2], marker)
			// A bootstrap is far under the limit whatever the script's size.
			assert.Less(t, len(cmd[2]), 1024)
		})
	}
}

// interpreter describes one language for the tests below, which run each bootstrap on
// this machine. The integration tests run them in the real images, in the sandbox.
type interpreter struct {
	scriptType types.ScriptType
	binary     string
	print      func(text string) string
	// readStdin prints what the script finds on stdin, as `stdin=[...]`.
	readStdin string
	exit7     string
	// leftovers prints any name a bootstrap could have left where the script sees it.
	leftovers string
	// block keeps the job running, doing nothing, in its last command.
	block string
	// lineNumber prints the line it is on. syntaxError fails to parse, and syntaxErrorAt
	// is how that error names the job's second line, the loader being its first.
	lineNumber    string
	lineNumberAt  string
	syntaxError   string
	syntaxErrorAt string
}

var interpreters = []interpreter{
	{
		scriptType: types.ScriptTypeBash,
		binary:     "/bin/bash",
		print:      func(text string) string { return `echo "` + text + `"` },
		readStdin:  `IFS= read -r line; echo "stdin=[$line]"`,
		exit7:      "exit 7",
		leftovers:  `compgen -v | grep cronium_script || true`,
		block:      "sleep 1000",

		lineNumber:    `echo "line=$LINENO"`,
		lineNumberAt:  "line=2",
		syntaxError:   "if then",
		syntaxErrorAt: "line 2: syntax error",
	},
	{
		scriptType: types.ScriptTypePython,
		binary:     "python3",
		print:      func(text string) string { return `print("` + text + `")` },
		readStdin:  `import sys; print("stdin=[" + sys.stdin.read() + "]")`,
		exit7:      "import sys; sys.exit(7)",
		leftovers:  `print(*[k for k in globals() if k in ("sys", "source")])`,
		block:      "import time; time.sleep(1000)",

		lineNumber:    `import sys; print("line=" + str(sys._getframe().f_lineno))`,
		lineNumberAt:  "line=2",
		syntaxError:   "if then",
		syntaxErrorAt: `File "<string>", line 2`,
	},
	{
		scriptType: types.ScriptTypeNode,
		binary:     "node",
		print:      func(text string) string { return `console.log("` + text + `");` },
		readStdin:  `console.log("stdin=[" + require('fs').readFileSync(0, 'utf8') + "]");`,
		exit7:      "process.exit(7);",
		leftovers:  `console.log(typeof source === "undefined" ? "" : "source");`,
		block:      "setTimeout(() => {}, 1000000);",

		lineNumber:   `console.log(new Error().stack.split("\n")[1]);`,
		lineNumberAt: "[eval]:2:",
		// V8 stops parsing here, before the end of the source, which is why the name of
		// the script has to be on the loader's line: this would report <anonymous_script>.
		syntaxError:   "return 3",
		syntaxErrorAt: "[eval]:2\n",
	},
}

// forEachInterpreter runs a test for each language this machine can run. PYTHONPATH and
// NODE_PATH hold a stand-in SDK, because the loader imports one and the real one lives
// in the images.
func forEachInterpreter(t *testing.T, test func(t *testing.T, in interpreter)) {
	t.Helper()
	sdk := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "cronium.py"), nil, 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "cronium.js"), nil, 0o600))
	t.Setenv("PYTHONPATH", sdk)
	t.Setenv("NODE_PATH", sdk)

	for _, in := range interpreters {
		t.Run(string(in.scriptType), func(t *testing.T) {
			if _, err := exec.LookPath(in.binary); err != nil {
				t.Skipf("%s is not on this machine: %v", in.binary, err)
			}
			test(t, in)
		})
	}
}

// runBootstrap runs the job's real command with deliver's bytes on stdin.
func runBootstrap(t *testing.T, in interpreter, content string, deliver func(source []byte) []byte) (stdout, stderr string, exitCode int) {
	t.Helper()
	script := &types.Script{Type: in.scriptType, Content: content}
	argv := newUnitExecutor().buildCommand(script)

	cmd := exec.Command(in.binary, argv[1:]...)
	cmd.Stdin = bytes.NewReader(deliver(scriptSource(script)))
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &outBuf, &errBuf
	err := cmd.Run()

	var exitErr *exec.ExitError
	if err != nil && !errors.As(err, &exitErr) {
		t.Fatalf("could not run %s: %v", in.binary, err)
	}
	return outBuf.String(), errBuf.String(), cmd.ProcessState.ExitCode()
}

func whole(source []byte) []byte { return source }

func TestBootstrap_RunsALongScriptExactly(t *testing.T) {
	forEachInterpreter(t, func(t *testing.T, in interpreter) {
		// Trailing newlines and multi-byte text are where a byte count can go wrong.
		content := paddedScript(in, 2*maxArgBytes) + "\n\n\n"

		stdout, stderr, code := runBootstrap(t, in, content, whole)

		assert.Equal(t, "first héllo ✓\nlast wörld ✓\n", stdout)
		assert.Empty(t, stderr)
		assert.Equal(t, 0, code)
	})
}

// paddedScript prints a line first and last, with comments in between to reach size.
func paddedScript(in interpreter, size int) string {
	comment := "# padding héllo ✓\n"
	if in.scriptType == types.ScriptTypeNode {
		comment = "// padding héllo ✓\n"
	}
	first, last := in.print("first héllo ✓")+"\n", in.print("last wörld ✓")+"\n"
	var b strings.Builder
	b.WriteString(first)
	for b.Len()+len(comment)+len(last) <= size {
		b.WriteString(comment)
	}
	b.WriteString(last)
	return b.String()
}

func TestBootstrap_ScriptFindsStdinAtItsEnd(t *testing.T) {
	// `bash -s` would hand the script's own next line to this read.
	forEachInterpreter(t, func(t *testing.T, in interpreter) {
		content := in.readStdin + "\n" + in.print("next line") + "\n"

		stdout, stderr, code := runBootstrap(t, in, content, whole)

		assert.Equal(t, "stdin=[]\nnext line\n", stdout)
		assert.Empty(t, stderr)
		assert.Equal(t, 0, code)
	})
}

func TestBootstrap_KeepsTheExitCode(t *testing.T) {
	forEachInterpreter(t, func(t *testing.T, in interpreter) {
		_, _, code := runBootstrap(t, in, in.exit7, whole)
		assert.Equal(t, 7, code)
	})
}

func TestBootstrap_RefusesAnythingButTheWholeScript(t *testing.T) {
	deliveries := map[string]func(source []byte) []byte{
		"cut off":                func(source []byte) []byte { return source[:len(source)-1] },
		"cut off inside a char":  func(source []byte) []byte { return source[:bytes.IndexRune(source, '✓')+1] },
		"nothing":                func([]byte) []byte { return nil },
		"more than was expected": func(source []byte) []byte { return append(source[:len(source):len(source)], '\n') },
	}
	forEachInterpreter(t, func(t *testing.T, in interpreter) {
		for name, deliver := range deliveries {
			t.Run(name, func(t *testing.T) {
				content := in.print("ran ✓") + "\n" + in.print("ran again ✓") + "\n"

				stdout, stderr, code := runBootstrap(t, in, content, deliver)

				assert.Empty(t, stdout, "no part of the script may run")
				assert.Equal(t, scriptNotDeliveredMessage+"\n", stderr)
				assert.Equal(t, scriptNotDeliveredExitCode, code)
			})
		}
	})
}

func TestBootstrap_LeavesNoNamesBehind(t *testing.T) {
	forEachInterpreter(t, func(t *testing.T, in interpreter) {
		stdout, stderr, code := runBootstrap(t, in, in.leftovers, whole)
		assert.Empty(t, strings.TrimSpace(stdout))
		assert.Empty(t, stderr)
		assert.Equal(t, 0, code)
	})
}

// attachedStdin is a hijacked connection over a unix socket, as to the Docker daemon,
// and the daemon's end of it.
func attachedStdin(t *testing.T) (*client.HijackedResponse, net.Conn) {
	t.Helper()
	// t.TempDir can be longer than a socket path may be.
	dir, err := os.MkdirTemp("", "cronium")
	require.NoError(t, err)
	t.Cleanup(func() { _ = os.RemoveAll(dir) })

	listener, err := net.Listen("unix", filepath.Join(dir, "docker.sock"))
	require.NoError(t, err)
	defer listener.Close()

	conn, err := net.Dial("unix", listener.Addr().String())
	require.NoError(t, err)
	daemon, err := listener.Accept()
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = conn.Close()
		_ = daemon.Close()
	})

	stdin := client.NewHijackedResponse(conn, "")
	return &stdin, daemon
}

// moreThanASocketBuffers is enough that writing it blocks until someone reads it.
func moreThanASocketBuffers() []byte {
	return bytes.Repeat([]byte("# a line of script\n"), 1<<20)
}

func TestDeliverScript_SendsEverythingAndEndsStdin(t *testing.T) {
	stdin, daemon := attachedStdin(t)
	source := moreThanASocketBuffers()
	received := make(chan []byte, 1)
	go func() {
		data, _ := io.ReadAll(daemon)
		received <- data
	}()

	require.NoError(t, deliverScript(context.Background(), stdin, source))

	// ReadAll returning at all means the daemon saw the end of stdin.
	assert.True(t, bytes.Equal(source, <-received), "the daemon must receive the script exactly")

	// The end came from a half-close, so the connection itself is still up.
	_, err := daemon.Write([]byte("x"))
	require.NoError(t, err)
	_, err = io.ReadFull(stdin.Conn, make([]byte, 1))
	assert.NoError(t, err)
}

func TestDeliverScript_ClosesTheConnectionWhenAWriteFails(t *testing.T) {
	stdin, daemon := attachedStdin(t)
	require.NoError(t, daemon.Close())

	require.Error(t, deliverScript(context.Background(), stdin, []byte("script")))

	_, err := stdin.Conn.Write([]byte("x"))
	assert.ErrorIs(t, err, net.ErrClosed)
}

func TestDeliverScript_GivesUpWhenTheContextEnds(t *testing.T) {
	stdin, daemon := attachedStdin(t)
	source := moreThanASocketBuffers()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// The daemon reads nothing yet, so this blocks in the write.
	done := make(chan error, 1)
	go func() { done <- deliverScript(ctx, stdin, source) }()
	select {
	case err := <-done:
		t.Fatalf("delivery should still be blocked, returned %v", err)
	case <-time.After(100 * time.Millisecond):
	}

	cancel()

	select {
	case err := <-done:
		require.Error(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("delivery did not stop when its context ended")
	}

	// The daemon sees an end short of the whole script, which is what the bootstrap
	// refuses, rather than stdin staying open.
	received, err := io.ReadAll(daemon)
	require.NoError(t, err)
	assert.Less(t, len(received), len(source))
}

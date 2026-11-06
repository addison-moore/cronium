//go:build integration

package container

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/moby/moby/client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// jobLanguage holds what the tests below run in one language. Each script writes
// through that language's own file API, then reads the file back by absolute path.
type jobLanguage struct {
	scriptType types.ScriptType
	// writeInWorkingDir prints "written" and the working directory.
	writeInWorkingDir string
	// writeInHome prints "written" and the language's own idea of the home directory.
	writeInHome string
	// printUID prints the uid the job runs as.
	printUID string
	// runProbe runs the shell script in $SANDBOX_PROBE, so that the same checks run
	// in each language's image.
	runProbe string
}

var jobLanguages = []jobLanguage{
	{
		scriptType: types.ScriptTypeBash,
		writeInWorkingDir: `echo written > f
cat /workspace/f
pwd
`,
		writeInHome: `echo written > "$HOME/f"
cat ~/f
echo ~
`,
		printUID: "id -u\n",
		runProbe: `sh -c "$SANDBOX_PROBE"` + "\n",
	},
	{
		scriptType: types.ScriptTypePython,
		writeInWorkingDir: `import os
with open('f', 'w') as out:
    print('written', file=out)
print(open('/workspace/f').read().strip())
print(os.getcwd())
`,
		writeInHome: `import os
with open(os.path.expanduser('~/f'), 'w') as out:
    print('written', file=out)
print(open(os.environ['HOME'] + '/f').read().strip())
print(os.path.expanduser('~'))
`,
		printUID: "import os\nprint(os.getuid())\n",
		runProbe: `import os, subprocess
raise SystemExit(subprocess.call(['sh', '-c', os.environ['SANDBOX_PROBE']]))
`,
	},
	{
		scriptType: types.ScriptTypeNode,
		writeInWorkingDir: `require('fs').writeFileSync('f', 'written\n');
process.stdout.write(require('fs').readFileSync('/workspace/f'));
console.log(process.cwd());
`,
		writeInHome: `require('fs').writeFileSync(require('os').homedir() + '/f', 'written\n');
process.stdout.write(require('fs').readFileSync(process.env.HOME + '/f'));
console.log(require('os').homedir());
`,
		printUID: "console.log(process.getuid());\n",
		runProbe: `process.exitCode = require('child_process').spawnSync('sh', ['-c', process.env.SANDBOX_PROBE], {stdio: 'inherit'}).status;
`,
	},
}

// jobRun is what a job reported through runContainer's updates.
type jobRun struct {
	stdout, stderr []string
	status         types.JobStatus
	exitCode       int
}

// productionSandbox is the production sandbox on the real Docker daemon, on no network,
// so its jobs need no sidecar. It skips the test when Docker is unreachable.
func productionSandbox(t *testing.T, ctx context.Context) *Executor {
	t.Helper()
	cli, err := client.New(client.FromEnv)
	if err != nil {
		t.Skipf("Docker client unavailable: %v", err)
	}
	if _, err := cli.Ping(ctx, client.PingOptions{}); err != nil {
		t.Skipf("Docker daemon unreachable: %v", err)
	}
	e := hardenedExecutor()
	e.dockerClient = cli
	e.tokens = make(map[string]string)
	e.executionIDs = make(map[string]string)
	e.sidecar = NewSidecarManager(e, e.log)
	return e
}

// runScriptInSandbox runs a script through the production create and run paths. It
// skips the test if the language's image is missing, because it never pulls or builds.
func runScriptInSandbox(t *testing.T, ctx context.Context, e *Executor, scriptType types.ScriptType, content string, env map[string]string) jobRun {
	t.Helper()
	image := e.getImageForScript(scriptType)
	if _, err := e.dockerClient.ImageInspect(ctx, image); err != nil {
		t.Skipf("%s not present locally (this test does not build it): %v", image, err)
	}

	suffix := make([]byte, 6)
	_, err := rand.Read(suffix)
	require.NoError(t, err)
	job := &types.Job{
		ID:   "writable-dirs-" + hex.EncodeToString(suffix),
		Type: types.JobTypeContainer,
		Execution: types.ExecutionConfig{
			Script:      &types.Script{Type: scriptType, Content: content},
			Environment: env,
		},
	}
	// The bash SDK exits at once without these, as it should in a real job.
	e.sidecar.storeExecutionToken(job.ID, "test-token")
	e.mu.Lock()
	e.executionIDs[job.ID] = "exec-" + job.ID
	e.mu.Unlock()

	id, err := e.createContainer(ctx, job, "none", nil)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = e.removeContainer(context.Background(), id)
	})

	updates := make(chan types.ExecutionUpdate, 1000)
	e.runContainer(ctx, id, job, updates, "exec-"+job.ID, NewExecutionTiming())
	close(updates)

	var run jobRun
	for update := range updates {
		switch data := update.Data.(type) {
		case *types.LogEntry:
			if data.Stream == "stdout" {
				run.stdout = append(run.stdout, data.Line)
			} else {
				run.stderr = append(run.stderr, data.Line)
			}
		case *types.StatusUpdate:
			if update.Type == types.UpdateTypeComplete {
				run.status = data.Status
				require.NotNil(t, data.ExitCode, "completed without an exit code: %s", data.Message)
				run.exitCode = *data.ExitCode
			}
		}
	}
	return run
}

// TestJobCanWriteToItsDirectoriesInTheSandbox is the plain promise: a job can write a
// file in its working directory and in $HOME, in each language.
func TestJobCanWriteToItsDirectoriesInTheSandbox(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	e := productionSandbox(t, ctx)

	for _, language := range jobLanguages {
		t.Run(string(language.scriptType), func(t *testing.T) {
			t.Run("working directory", func(t *testing.T) {
				run := runScriptInSandbox(t, ctx, e, language.scriptType, language.writeInWorkingDir, nil)

				assert.Empty(t, run.stderr)
				assert.Equal(t, 0, run.exitCode)
				assert.Equal(t, []string{"written", "/workspace"}, run.stdout)
			})
			t.Run("home", func(t *testing.T) {
				run := runScriptInSandbox(t, ctx, e, language.scriptType, language.writeInHome, nil)

				assert.Empty(t, run.stderr)
				assert.Equal(t, 0, run.exitCode)
				assert.Equal(t, []string{"written", jobHomeDir}, run.stdout)
			})
		})
	}
}

// TestJobCanWriteAsAnyConfiguredUserInTheSandbox covers why the fix can't lean on a
// particular user. CRONIUM_CONTAINER_SECURITY_USER can be any of these, and the images
// disagree: "cronium" is uid 1000 in the bash and Python images and uid 100 in the node
// image, where uid 1000 is the base image's `node` user. A uid no image knows has no
// passwd entry at all.
func TestJobCanWriteAsAnyConfiguredUserInTheSandbox(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	users := []struct {
		name, user string
		// wantUID is empty when the image decides.
		wantUID string
	}{
		{"the default", "1000:1000", "1000"},
		{"a uid with no group", "1000", "1000"},
		{"a uid and gid no image knows", "2000:3000", "2000"},
		{"the image's user by name", "cronium", ""},
		{"unset, so the image's own USER", "", ""},
	}
	for _, language := range jobLanguages {
		for _, tc := range users {
			t.Run(string(language.scriptType)+"/"+tc.name, func(t *testing.T) {
				e := productionSandbox(t, ctx)
				e.config.Security.User = tc.user

				script := language.writeInWorkingDir + language.writeInHome + language.printUID
				run := runScriptInSandbox(t, ctx, e, language.scriptType, script, nil)

				assert.Empty(t, run.stderr)
				assert.Equal(t, 0, run.exitCode)
				require.Len(t, run.stdout, 5)
				assert.Equal(t, []string{"written", "/workspace", "written", jobHomeDir}, run.stdout[:4])
				if tc.wantUID != "" {
					assert.Equal(t, tc.wantUID, run.stdout[4])
				}
				assert.NotEqual(t, "0", run.stdout[4], "the job must not run as root")
			})
		}
	}
}

// sandboxProbe reports on the sandbox from inside a job. It is a shell script so that one
// set of checks runs in each image.
const sandboxProbe = `
echo "uid=$(id -u)"
echo "gid=$(id -g)"
grep -E '^(CapEff|CapBnd|NoNewPrivs):' /proc/self/status
for path in /f /app/f /etc/f /usr/local/bin/f; do
  touch "$path" 2>&1 && echo "wrote $path"
done
grep -E ' (/workspace|/home|/tmp) ' /proc/self/mounts
dd if=/dev/zero of="$HOME/past-the-limit" bs=1048576 count=101 2>&1
echo "dd exit=$?"
`

// TestJobStaysConfinedInTheSandbox checks, from inside a job in each image, that letting
// a job write to these directories has loosened nothing else.
// TestCreatedContainerHasHardenedHostConfig checks what the daemon recorded.
func TestJobStaysConfinedInTheSandbox(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	e := productionSandbox(t, ctx)

	for _, language := range jobLanguages {
		t.Run(string(language.scriptType), func(t *testing.T) {
			run := runScriptInSandbox(t, ctx, e, language.scriptType, language.runProbe, map[string]string{"SANDBOX_PROBE": sandboxProbe})
			require.Equal(t, 0, run.exitCode, "stdout: %v\nstderr: %v", run.stdout, run.stderr)
			assert.Empty(t, run.stderr)

			// Non-root, in both uid and gid.
			assert.Contains(t, run.stdout, "uid=1000")
			assert.Contains(t, run.stdout, "gid=1000")

			// No capabilities, none it could regain, and no way to gain privileges.
			assert.Contains(t, run.stdout, "CapEff:\t0000000000000000")
			assert.Contains(t, run.stdout, "CapBnd:\t0000000000000000")
			assert.Contains(t, run.stdout, "NoNewPrivs:\t1")

			// The rootfs refuses, including /app, which the bash and Python images give
			// this user. Read-only is checked before permissions, so the message says so.
			for _, path := range []string{"/f", "/app/f", "/etc/f", "/usr/local/bin/f"} {
				assert.NotContains(t, run.stdout, "wrote "+path)
				refused := false
				for _, line := range run.stdout {
					refused = refused || (strings.Contains(line, path) && strings.Contains(line, "Read-only file system"))
				}
				assert.True(t, refused, "no read-only refusal for %s in %v", path, run.stdout)
			}

			// Each writable directory is a tmpfs of the size asked for, and can't hold
			// anything that runs or anything setuid.
			for _, m := range e.buildMounts(&types.Job{}) {
				options := tmpfsOptionsInMountTable(t, run.stdout, m.Target)
				assert.Contains(t, options, "rw", m.Target)
				assert.Contains(t, options, "nosuid", m.Target)
				assert.Contains(t, options, "nodev", m.Target)
				assert.Contains(t, options, "noexec", m.Target)
				assert.Contains(t, options, fmt.Sprintf("size=%dk", m.TmpfsOptions.SizeBytes/1024), m.Target)
			}

			// A size in the mount table is only worth anything if the kernel enforces it.
			output := strings.Join(run.stdout, "\n")
			assert.Contains(t, output, "No space left on device")
			assert.Contains(t, output, "dd exit=1")
		})
	}
}

// tmpfsOptionsInMountTable finds a mount in lines of /proc/self/mounts and returns its
// options, failing the test unless it is a tmpfs.
func tmpfsOptionsInMountTable(t *testing.T, lines []string, target string) []string {
	t.Helper()
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) >= 4 && fields[1] == target {
			require.Equal(t, "tmpfs", fields[2], "%s is not a tmpfs: %s", target, line)
			return strings.Split(fields[3], ",")
		}
	}
	require.Failf(t, "no mount", "%s is not in the mount table: %v", target, lines)
	return nil
}

package container

import (
	"strings"
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/config"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/sirupsen/logrus"
)

// hardenedExecutor builds an Executor with the production-default container
// security posture (Phase 3.1).
func hardenedExecutor() *Executor {
	return &Executor{
		log: logrus.New(),
		config: config.ContainerConfig{
			Security: config.ContainerSecurityConfig{
				User:             "1000:1000",
				NoNewPrivileges:  true,
				DropCapabilities: []string{"ALL"},
				ReadOnlyRootfs:   true,
				SeccompProfile:   "default",
			},
			Resources: config.ResourceConfig{
				Defaults: config.ResourceLimits{
					CPU:    0.5,
					Memory: "512MB",
					Pids:   100,
				},
				Limits: config.ResourceLimits{
					CPU:    2.0,
					Memory: "2GB",
					Pids:   512,
				},
			},
		},
	}
}

func TestBuildHostConfig_SandboxHardening(t *testing.T) {
	e := hardenedExecutor()
	job := &types.Job{
		ID:        "job-1",
		Execution: types.ExecutionConfig{Script: &types.Script{Type: "BASH", Content: "echo hi"}},
	}

	hc := e.buildHostConfig(job, "cronium-net-job-1")

	// Every Linux capability dropped.
	if len(hc.CapDrop) != 1 || hc.CapDrop[0] != "ALL" {
		t.Fatalf("expected CapDrop [ALL], got %v", hc.CapDrop)
	}
	// Read-only root filesystem.
	if !hc.ReadonlyRootfs {
		t.Fatal("expected ReadonlyRootfs=true")
	}
	// Runs on its own per-job network.
	if string(hc.NetworkMode) != "cronium-net-job-1" {
		t.Fatalf("expected per-job network, got %q", hc.NetworkMode)
	}
	// no-new-privileges present.
	found := false
	for _, opt := range hc.SecurityOpt {
		if opt == "no-new-privileges" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected no-new-privileges in SecurityOpt, got %v", hc.SecurityOpt)
	}
}

func TestBuildHostConfig_FailsClosedWhenCapDropUnset(t *testing.T) {
	e := hardenedExecutor()
	e.config.Security.DropCapabilities = nil // operator left it empty

	hc := e.buildHostConfig(&types.Job{ID: "job-1"}, "net")
	if len(hc.CapDrop) != 1 || hc.CapDrop[0] != "ALL" {
		t.Fatalf("expected CapDrop to fall back to [ALL] when unconfigured, got %v", hc.CapDrop)
	}
}

func TestBuildResourceLimits_ClampsToMax(t *testing.T) {
	e := hardenedExecutor()
	// A job requesting far more than the configured maximum.
	job := &types.Job{Execution: types.ExecutionConfig{Resources: &types.Resources{
		CPULimit:    64,
		MemoryLimit: 64 * 1024 * 1024 * 1024, // 64GB
		PidsLimit:   100000,
	}}}

	r := e.buildResourceLimits(job)

	if r.NanoCPUs != int64(2.0*1e9) { // clamped to Limits.CPU=2.0
		t.Fatalf("CPU not clamped to max: got %d nanoCPUs", r.NanoCPUs)
	}
	if r.Memory != 2*1024*1024*1024 { // clamped to Limits.Memory=2GB
		t.Fatalf("memory not clamped to max: got %d", r.Memory)
	}
	if r.PidsLimit == nil || *r.PidsLimit != 512 { // clamped to Limits.Pids=512
		t.Fatalf("pids not clamped to max: got %v", r.PidsLimit)
	}
}

func TestBuildResourceLimits_PartialObjectGetsDefaults(t *testing.T) {
	e := hardenedExecutor()
	// Only CPU set — memory and pids must fall back to defaults, never unbounded.
	job := &types.Job{Execution: types.ExecutionConfig{Resources: &types.Resources{
		CPULimit: 1,
	}}}

	r := e.buildResourceLimits(job)
	if r.Memory != 512*1024*1024 {
		t.Fatalf("partial resource object left memory unbounded/wrong: got %d", r.Memory)
	}
	if r.PidsLimit == nil || *r.PidsLimit != 100 {
		t.Fatalf("partial resource object left pids unbounded/wrong: got %v", r.PidsLimit)
	}
	// A NOFILE ulimit is always set.
	foundNofile := false
	for _, u := range r.Ulimits {
		if u.Name == "nofile" {
			foundNofile = true
		}
	}
	if !foundNofile {
		t.Fatal("expected a nofile ulimit")
	}
}

func TestBuildMounts_WritableDirsAreTmpfs(t *testing.T) {
	e := hardenedExecutor()
	mounts := e.buildMounts(&types.Job{ID: "job-1"})

	want := map[string]bool{"/tmp": false, "/workspace": false, "/home": false}
	for _, m := range mounts {
		if _, ok := want[m.Target]; ok {
			if m.Type != "tmpfs" {
				t.Fatalf("%s must be tmpfs under a read-only rootfs, got %s", m.Target, m.Type)
			}
			want[m.Target] = true
		}
	}
	for dir, seen := range want {
		if !seen {
			t.Fatalf("expected a writable tmpfs mount at %s", dir)
		}
	}
}

// A job has to be able to write to each of these whichever user it runs as, so none can
// depend on who owns it. And each has to stay sized, because opening them up is only
// safe if what a job can put in them is still bounded.
func TestBuildMounts_WritableDirsTakeAnyUserAndHaveASizeLimit(t *testing.T) {
	e := hardenedExecutor()

	for _, m := range e.buildMounts(&types.Job{ID: "job-1"}) {
		if m.TmpfsOptions == nil {
			t.Fatalf("%s has no tmpfs options", m.Target)
		}
		if m.TmpfsOptions.Mode != 0o1777 {
			t.Errorf("%s has mode %o, which not every user can write to", m.Target, m.TmpfsOptions.Mode)
		}
		if m.TmpfsOptions.SizeBytes <= 0 {
			t.Errorf("%s has no size limit", m.Target)
		}
	}
}

func homeEntries(env []string) []string {
	var entries []string
	for _, entry := range env {
		if strings.HasPrefix(entry, "HOME=") {
			entries = append(entries, entry)
		}
	}
	return entries
}

// The image's HOME is hidden under the tmpfs at /home, so a job's HOME has to be a
// directory that the mounts themselves provide.
func TestBuildEnvironment_HomeIsAWritableMount(t *testing.T) {
	e := newUnitExecutor()
	job := scriptJob(types.ScriptTypeBash)

	entries := homeEntries(e.buildEnvironment(job))
	if len(entries) != 1 || entries[0] != "HOME="+jobHomeDir {
		t.Fatalf("expected HOME=%s once, got %v", jobHomeDir, entries)
	}

	for _, m := range e.buildMounts(job) {
		if m.Target == jobHomeDir {
			return
		}
	}
	t.Fatalf("no mount at %s, so a job's HOME wouldn't be writable", jobHomeDir)
}

func TestBuildEnvironment_JobCanSetItsOwnHome(t *testing.T) {
	e := newUnitExecutor()
	job := scriptJob(types.ScriptTypeBash)
	job.Execution.Environment = map[string]string{"HOME": "/tmp/somewhere"}

	entries := homeEntries(e.buildEnvironment(job))
	if len(entries) != 1 || entries[0] != "HOME=/tmp/somewhere" {
		t.Fatalf("expected only the job's own HOME, got %v", entries)
	}
}

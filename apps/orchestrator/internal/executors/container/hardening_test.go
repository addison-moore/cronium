package container

import (
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

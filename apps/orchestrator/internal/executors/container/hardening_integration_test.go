//go:build integration

package container

import (
	"context"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

// TestCreatedContainerHasHardenedHostConfig creates a REAL container with the
// production sandbox HostConfig and inspects it via the Docker API, asserting the
// daemon actually recorded the hardening (Phase 3.1) — not just that the option
// builder produced the right struct. Run with:
//
//	go test -tags integration ./internal/executors/container/ -run HardenedHostConfig
//
// It is skipped when Docker is unreachable or alpine:latest is not present
// locally (the test never pulls over the network).
func TestCreatedContainerHasHardenedHostConfig(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cli, err := client.New(client.FromEnv)
	if err != nil {
		t.Skipf("Docker client unavailable: %v", err)
	}
	if _, err := cli.Ping(ctx, client.PingOptions{}); err != nil {
		t.Skipf("Docker daemon unreachable: %v", err)
	}
	const image = "alpine:latest"
	if _, err := cli.ImageInspect(ctx, image); err != nil {
		t.Skipf("%s not present locally (test does not pull): %v", image, err)
	}

	e := hardenedExecutor()
	e.dockerClient = cli
	job := &types.Job{
		ID:        "hardening-inspect",
		Execution: types.ExecutionConfig{Script: &types.Script{Type: "BASH", Content: "true"}},
	}

	// "none" network so the test needs no pre-created per-job network.
	hostConfig := e.buildHostConfig(job, "none")
	cfg := &container.Config{
		Image: image,
		Cmd:   []string{"sleep", "30"},
		User:  e.config.Security.User,
	}

	created, err := cli.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config:     cfg,
		HostConfig: hostConfig,
		Name:       "cronium-hardening-inspect-test",
	})
	if err != nil {
		t.Fatalf("failed to create container: %v", err)
	}
	defer func() {
		_, _ = cli.ContainerRemove(context.Background(), created.ID, client.ContainerRemoveOptions{Force: true})
	}()

	inspect, err := cli.ContainerInspect(ctx, created.ID, client.ContainerInspectOptions{})
	if err != nil {
		t.Fatalf("failed to inspect container: %v", err)
	}
	hc := inspect.Container.HostConfig
	if hc == nil {
		t.Fatal("inspect returned no HostConfig")
	}

	// Every capability dropped.
	if !sliceHas(hc.CapDrop, "ALL") {
		t.Errorf("expected CapDrop to contain ALL, got %v", hc.CapDrop)
	}
	// Read-only root filesystem.
	if !hc.ReadonlyRootfs {
		t.Error("expected ReadonlyRootfs=true on the created container")
	}
	// no-new-privileges applied.
	if !sliceHas(hc.SecurityOpt, "no-new-privileges") {
		t.Errorf("expected SecurityOpt to contain no-new-privileges, got %v", hc.SecurityOpt)
	}
	// Non-root UID/GID.
	if got := inspect.Container.Config.User; got != "1000:1000" {
		t.Errorf("expected User 1000:1000, got %q", got)
	}
	// Isolated network mode (no shared/host network for the job container).
	if got := string(hc.NetworkMode); got != "none" {
		t.Errorf("expected NetworkMode none, got %q", got)
	}
	// tmpfs work directories present (writable scratch on a read-only rootfs).
	if !hasTmpfs(hc, "/workspace") || !hasTmpfs(hc, "/tmp") {
		t.Errorf("expected tmpfs mounts for /workspace and /tmp, got mounts=%v tmpfs=%v", hc.Mounts, hc.Tmpfs)
	}
}

func sliceHas(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// hasTmpfs reports whether the created container has a tmpfs at target, checking
// both the HostConfig.Mounts list and the daemon-normalized Tmpfs map.
func hasTmpfs(hc *container.HostConfig, target string) bool {
	for _, m := range hc.Mounts {
		if string(m.Type) == "tmpfs" && m.Target == target {
			return true
		}
	}
	if hc.Tmpfs != nil {
		if _, ok := hc.Tmpfs[target]; ok {
			return true
		}
	}
	return false
}

package container

import (
	"testing"
)

func TestValidateDockerEndpoint(t *testing.T) {
	t.Setenv("CRONIUM_ALLOW_INSECURE_DOCKER_ENDPOINT", "")
	// Local transports are always allowed.
	for _, ok := range []string{
		"unix:///var/run/docker.sock",
		"npipe:////./pipe/docker_engine",
	} {
		if err := validateDockerEndpoint(ok); err != nil {
			t.Fatalf("expected %q to be allowed, got %v", ok, err)
		}
	}
	// A plaintext remote endpoint must fail closed.
	if err := validateDockerEndpoint("tcp://10.0.0.5:2375"); err == nil {
		t.Fatal("expected tcp:// endpoint to be refused")
	}
	// Explicit operator opt-in overrides the refusal.
	t.Setenv("CRONIUM_ALLOW_INSECURE_DOCKER_ENDPOINT", "true")
	if err := validateDockerEndpoint("tcp://10.0.0.5:2375"); err != nil {
		t.Fatalf("opt-in should allow tcp:// endpoint, got %v", err)
	}
}

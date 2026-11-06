package container

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/moby/moby/client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var dockerAPIPath = regexp.MustCompile(`^/v[0-9.]+`)

// fakeDocker is a daemon that has only the images it's given, and can refuse a pull. It
// refuses to create a container, which ends a job's setup there, because what these tests
// ask is which image it got that far with.
type fakeDocker struct {
	local      map[string]bool
	refusePull bool

	mu        sync.Mutex
	inspected []string
	pulled    []string
	created   []string
}

func (d *fakeDocker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := dockerAPIPath.ReplaceAllString(r.URL.Path, "")
	d.mu.Lock()
	defer d.mu.Unlock()
	switch {
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/images/") && strings.HasSuffix(path, "/json"):
		name := strings.TrimSuffix(strings.TrimPrefix(path, "/images/"), "/json")
		d.inspected = append(d.inspected, name)
		if !d.local[name] {
			http.Error(w, `{"message":"No such image: `+name+`"}`, http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(`{"Id":"sha256:abc"}`))
	case r.Method == http.MethodPost && path == "/images/create":
		image := r.URL.Query().Get("fromImage") + ":" + r.URL.Query().Get("tag")
		d.pulled = append(d.pulled, image)
		if d.refusePull {
			http.Error(w, `{"message":"pull access denied"}`, http.StatusForbidden)
			return
		}
		d.local[image] = true
		_, _ = w.Write([]byte(`{"status":"done"}`))
	case r.Method == http.MethodPost && path == "/containers/create":
		var body struct{ Image string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		d.created = append(d.created, body.Image)
		http.Error(w, `{"message":"this fake starts nothing"}`, http.StatusInternalServerError)
	default:
		http.Error(w, `{"message":"unexpected call to `+path+`"}`, http.StatusNotImplemented)
	}
}

// executorOn makes an executor talking to a daemon holding these images.
func executorOn(t *testing.T, localImages ...string) (*Executor, *fakeDocker) {
	t.Helper()
	docker := &fakeDocker{local: map[string]bool{}}
	for _, image := range localImages {
		docker.local[image] = true
	}
	server := httptest.NewServer(docker)
	t.Cleanup(server.Close)
	cli, err := client.New(client.WithHost("tcp://"+server.Listener.Addr().String()), client.WithAPIVersion("1.44"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = cli.Close() })
	e := newUnitExecutor()
	e.dockerClient = cli
	return e, docker
}

func TestDefaultImages(t *testing.T) {
	cases := []struct {
		name      string
		get       func(e *Executor) string
		local     string
		published string
	}{
		{
			name:      "bash",
			get:       func(e *Executor) string { return e.getImageForScript(context.Background(), types.ScriptTypeBash) },
			local:     "cronium/runner:bash-alpine",
			published: "ghcr.io/addison-moore/cronium-runner-bash",
		},
		{
			name:      "python",
			get:       func(e *Executor) string { return e.getImageForScript(context.Background(), types.ScriptTypePython) },
			local:     "cronium/runner:python-alpine",
			published: "ghcr.io/addison-moore/cronium-runner-python",
		},
		{
			name:      "node",
			get:       func(e *Executor) string { return e.getImageForScript(context.Background(), types.ScriptTypeNode) },
			local:     "cronium/runner:node-alpine",
			published: "ghcr.io/addison-moore/cronium-runner-node",
		},
		{
			name:      "the runtime sidecar",
			get:       func(e *Executor) string { return e.sidecar.getRuntimeImage(context.Background()) },
			local:     "cronium/runtime-api:latest",
			published: "ghcr.io/addison-moore/cronium-runtime",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Run("on a fresh host it's the image published with this build", func(t *testing.T) {
				e, _ := executorOn(t)
				e.config.ImageTag = "1.2.3"
				assert.Equal(t, c.published+":1.2.3", c.get(e))
			})

			t.Run("with no tag it's the published image's latest", func(t *testing.T) {
				e, _ := executorOn(t)
				assert.Equal(t, c.published+":latest", c.get(e))
			})

			t.Run("an image under the old name stays in use", func(t *testing.T) {
				e, _ := executorOn(t, c.local)
				e.config.ImageTag = "1.2.3"
				assert.Equal(t, c.local, c.get(e))
			})

			t.Run("the published image isn't taken for the old name", func(t *testing.T) {
				e, _ := executorOn(t, c.published+":1.2.3")
				e.config.ImageTag = "1.2.3"
				assert.Equal(t, c.published+":1.2.3", c.get(e))
			})
		})
	}
}

func TestConfiguredImagesWinWithoutAskingDocker(t *testing.T) {
	e, docker := executorOn(t, "cronium/runner:bash-alpine", "cronium/runtime-api:latest")
	e.config.Images = map[string]string{"bash": "custom/bash:1"}
	e.config.Runtime.Image = "custom/runtime:2"
	ctx := context.Background()

	assert.Equal(t, "custom/bash:1", e.getImageForScript(ctx, types.ScriptTypeBash))
	assert.Equal(t, "custom/runtime:2", e.sidecar.getRuntimeImage(ctx))
	assert.Empty(t, docker.inspected)
}

func TestAnEmptyConfiguredImageMeansTheDefault(t *testing.T) {
	e, _ := executorOn(t)
	e.config.Images = map[string]string{"python": ""}

	assert.Equal(t,
		"ghcr.io/addison-moore/cronium-runner-python:latest",
		e.getImageForScript(context.Background(), types.ScriptTypePython),
	)
}

// Validate refuses any other type before a job gets this far.
func TestAnUnknownScriptTypeGetsTheBashImage(t *testing.T) {
	e, _ := executorOn(t)

	assert.Equal(t,
		"ghcr.io/addison-moore/cronium-runner-bash:latest",
		e.getImageForScript(context.Background(), "RUBY"),
	)
}

func TestAJobOnAFreshHostPullsThePublishedImage(t *testing.T) {
	e, docker := executorOn(t)
	e.config.ImageTag = "1.2.3"

	_, err := e.createContainer(context.Background(), scriptJob(types.ScriptTypePython), "network", nil)

	require.Error(t, err, "the fake starts nothing")
	assert.Equal(t, []string{"ghcr.io/addison-moore/cronium-runner-python:1.2.3"}, docker.pulled)
	assert.Equal(t, []string{"ghcr.io/addison-moore/cronium-runner-python:1.2.3"}, docker.created)
}

func TestTheSidecarOnAFreshHostPullsThePublishedImage(t *testing.T) {
	e, docker := executorOn(t)
	e.config.ImageTag = "1.2.3"

	_, err := e.sidecar.CreateRuntimeSidecar(context.Background(), scriptJob(types.ScriptTypeBash), "network")

	require.Error(t, err, "the fake starts nothing")
	assert.Equal(t, []string{"ghcr.io/addison-moore/cronium-runtime:1.2.3"}, docker.pulled)
	assert.Equal(t, []string{"ghcr.io/addison-moore/cronium-runtime:1.2.3"}, docker.created)
}

func TestTheSidecarPullsAConfiguredImageThatIsMissing(t *testing.T) {
	e, docker := executorOn(t)
	e.config.Runtime.Image = "registry.example:5000/runtime:2"

	_, err := e.sidecar.CreateRuntimeSidecar(context.Background(), scriptJob(types.ScriptTypeBash), "network")

	require.Error(t, err, "the fake starts nothing")
	assert.Equal(t, []string{"registry.example:5000/runtime:2"}, docker.pulled)
}

func TestTheSidecarDoesntPullAnImageItHas(t *testing.T) {
	e, docker := executorOn(t, "ghcr.io/addison-moore/cronium-runtime:1.2.3")
	e.config.ImageTag = "1.2.3"

	_, err := e.sidecar.CreateRuntimeSidecar(context.Background(), scriptJob(types.ScriptTypeBash), "network")

	require.Error(t, err, "the fake starts nothing")
	assert.Empty(t, docker.pulled)
	assert.Equal(t, []string{"ghcr.io/addison-moore/cronium-runtime:1.2.3"}, docker.created)
}

func TestAnImageThatCantBePulledFailsTheJobNamingIt(t *testing.T) {
	t.Run("the sidecar", func(t *testing.T) {
		e, docker := executorOn(t)
		docker.refusePull = true

		_, err := e.sidecar.CreateRuntimeSidecar(context.Background(), scriptJob(types.ScriptTypeBash), "network")

		require.Error(t, err)
		assert.Contains(t, err.Error(), "ghcr.io/addison-moore/cronium-runtime:latest")
		assert.Contains(t, err.Error(), "pull access denied")
		assert.Empty(t, docker.created)
	})

	t.Run("the job", func(t *testing.T) {
		e, docker := executorOn(t)
		docker.refusePull = true

		_, err := e.createContainer(context.Background(), scriptJob(types.ScriptTypeNode), "network", nil)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "ghcr.io/addison-moore/cronium-runner-node:latest")
		assert.Empty(t, docker.created)
	})
}

// The old names would come from Docker Hub, where this project doesn't publish.
func TestAnOldNameIsNeverPulled(t *testing.T) {
	for _, scriptType := range []types.ScriptType{types.ScriptTypeBash, types.ScriptTypePython, types.ScriptTypeNode} {
		e, docker := executorOn(t)

		_, _ = e.createContainer(context.Background(), scriptJob(scriptType), "network", nil)
		_, _ = e.sidecar.CreateRuntimeSidecar(context.Background(), scriptJob(scriptType), "network")

		require.Len(t, docker.pulled, 2)
		for _, image := range docker.pulled {
			assert.True(t, strings.HasPrefix(image, "ghcr.io/"), "pulled %s", image)
		}
	}
}

// A name here that CI doesn't publish leaves a fresh install unable to run a script, and
// nothing else would say so until someone tried to.
func TestCIPublishesEveryDefaultImage(t *testing.T) {
	read := func(path string) string {
		content, err := os.ReadFile(filepath.Join("../../../../..", path))
		require.NoError(t, err)
		return string(content)
	}
	publish := read(".github/workflows/docker-publish.yml")
	smoke := read(".github/workflows/install-smoke.yml")

	assert.Contains(t, publish, "IMAGE_NAME_RUNTIME: ${{ github.repository }}-runtime")
	// The orchestrator has to be built knowing the tag, and only published once what it
	// asks for by that tag is there.
	assert.Contains(t, publish, "BUILD_VERSION=${{ needs.published-tag.outputs.tag }}")
	job := publish[strings.Index(publish, "\n  build-and-push:"):strings.Index(publish, "\n  publish-runner-images:")]
	assert.Contains(t, job, "needs: [published-tag, publish-runner-images]")
	assert.Less(t,
		strings.Index(publish, "name: Build and push Runtime"),
		strings.Index(publish, "name: Build and push Orchestrator"),
		"the runtime has to be there before an orchestrator that asks for it",
	)
	assert.Contains(t, publish, "IMAGE_NAME: ${{ github.repository }}-runner-${{ matrix.image }}")
	require.Len(t, defaultJobImages, 3)
	for scriptType, image := range defaultJobImages {
		name := strings.TrimPrefix(image.published, "ghcr.io/addison-moore/cronium-runner-")
		assert.Contains(t, publish, "- image: "+name+"\n", "%s isn't published", scriptType)
		assert.Contains(t, smoke, image.published+":latest", "%s isn't built for Install Smoke", scriptType)
	}
}

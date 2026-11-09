package container

import (
	"context"
	"strings"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
)

// defaultImage is what a job uses when nothing configures an image.
type defaultImage struct {
	// local is the name a source checkout builds, and the only name there was before these
	// images were published, so an install that already runs scripts built or tagged it
	// itself. It's used if it's there, so that install keeps what it made. It's never
	// pulled: it would come from Docker Hub, where this project doesn't publish.
	local string
	// published is the repository in .github/workflows/docker-publish.yml. A fresh install
	// gets the image from there, at the tag it was published under with this build.
	published string
}

var (
	defaultRuntimeImage = defaultImage{
		local:     "cronium/runtime-api:latest",
		published: "ghcr.io/addison-moore/cronium-runtime",
	}
	defaultJobImages = map[types.ScriptType]defaultImage{
		types.ScriptTypeBash: {
			local:     "cronium/runner:bash-alpine",
			published: "ghcr.io/addison-moore/cronium-runner-bash",
		},
		types.ScriptTypePython: {
			local:     "cronium/runner:python-alpine",
			published: "ghcr.io/addison-moore/cronium-runner-python",
		},
		types.ScriptTypeNode: {
			local:     "cronium/runner:node-alpine",
			published: "ghcr.io/addison-moore/cronium-runner-node",
		},
	}
)

// resolveDefaultImage picks between an image's two names.
func (e *Executor) resolveDefaultImage(ctx context.Context, image defaultImage) string {
	if _, err := e.dockerClient.ImageInspect(ctx, image.local); err == nil {
		return image.local
	}
	tag := e.config.ImageTag
	if tag == "" {
		tag = "latest"
	}
	return image.published + ":" + tag
}

// getImageForScript returns the image a script of this type runs in. A configured image
// wins, under the lowercased script type.
func (e *Executor) getImageForScript(ctx context.Context, scriptType types.ScriptType) string {
	if image := e.config.Images[strings.ToLower(string(scriptType))]; image != "" {
		return image
	}
	image, ok := defaultJobImages[scriptType]
	if !ok {
		// Validate refuses any other type before a job gets this far.
		image = defaultJobImages[types.ScriptTypeBash]
	}
	return e.resolveDefaultImage(ctx, image)
}

// getRuntimeImage returns the image a job's runtime API sidecar runs in. A configured
// image wins.
func (sm *SidecarManager) getRuntimeImage(ctx context.Context) string {
	if image := sm.executor.config.Runtime.Image; image != "" {
		return image
	}
	return sm.executor.resolveDefaultImage(ctx, defaultRuntimeImage)
}

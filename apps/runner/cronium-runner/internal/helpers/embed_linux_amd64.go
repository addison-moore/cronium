//go:build !nohelpers

package helpers

import "embed"

// The file name limits this to linux/amd64, so a runner carries only the helpers
// for its own platform. build-helpers.sh generates these files; they are not in
// git. A missing one fails the build here rather than a job on a server. Compile
// without them using `-tags nohelpers`.
//
//go:embed binaries/linux_amd64_cronium.input
//go:embed binaries/linux_amd64_cronium.output
//go:embed binaries/linux_amd64_cronium.getVariable
//go:embed binaries/linux_amd64_cronium.setVariable
//go:embed binaries/linux_amd64_cronium.setCondition
//go:embed binaries/linux_amd64_cronium.event
//go:embed binaries/linux_amd64_cronium.toolAction
var embeddedHelpers embed.FS

const embeddedPlatform = "linux_amd64"

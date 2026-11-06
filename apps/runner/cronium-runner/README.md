# Cronium Runner

The CLI the orchestrator installs on a remote server over SSH. It verifies a signed payload, runs the script inside it, and gives that script the same SDK it would have in a container (`apps/runtime/runtime-helpers`).

## Helper binaries

The SDK runs on small helper binaries, one per directory in `cmd/helpers`, built from source and embedded in the runner:

- `./build-helpers.sh` generates them in `internal/helpers/binaries`, which git ignores. Every build of the runner runs it first, including `apps/orchestrator/Dockerfile`.
- A runner embeds only the helpers for its own platform, chosen by the file names `internal/helpers/embed_linux_amd64.go` and `embed_linux_arm64.go`.
- Without the generated files, a build on Linux fails at `go:embed`. That is deliberate, because a runner without helpers cannot run a job.
- Commands that only need the code to compile take `-tags nohelpers`.

To add a helper, add its directory in `cmd/helpers`, then add it to `HelperNames` in `internal/helpers/extract.go` and to both embed files.

## Commands

```bash
make test            # go test -tags nohelpers ./...
make build           # helpers, then a runner for linux/amd64 and linux/arm64 in dist/
make build-optimized # the same, stripped, and copied into apps/orchestrator/artifacts/runners
```

The dev stack's orchestrator runs the runner from `apps/orchestrator/artifacts/runners/dev`, so run `make build-optimized` to try a change on a remote server. The production orchestrator image builds its own.

## Testing against the container SDK

`internal/executor/parity_test.go` runs one script through the real container SDK and through the real runner and helpers, then compares stdout, stderr, exit code and the requests sent to a fake runtime. It covers bash, Python and Node, and skips a language whose tools are not installed. When you change either SDK, extend the scripts there.

package executor

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	"github.com/addison-moore/cronium/apps/runner/cronium-runner/internal/manifest"
	"github.com/addison-moore/cronium/apps/runner/cronium-runner/internal/payload"
	"github.com/addison-moore/cronium/apps/runner/cronium-runner/pkg/types"
	"github.com/sirupsen/logrus"
)

// Executor handles payload execution
type Executor struct {
	log       *logrus.Logger
	workDir   string
	manifest  *types.Manifest
	stdout    io.Writer
	stderr    io.Writer
	cleanupMu sync.Mutex
	cleaned   bool
}

// New creates a new executor
func New(log *logrus.Logger) *Executor {
	return &Executor{
		log:    log,
		stdout: os.Stdout,
		stderr: os.Stderr,
	}
}

// ScriptExitError is a script that ran and exited non-zero.
type ScriptExitError struct {
	Code int
}

func (e *ScriptExitError) Error() string {
	return fmt.Sprintf("script exited with code %d", e.Code)
}

// Execute runs a payload
func (e *Executor) Execute(payloadPath string) error {
	// Set up signal handling for cleanup
	e.setupSignalHandling()

	// Verify payload signature (enforced when CRONIUM_VERIFY_KEY is set)
	e.log.Info("Verifying payload")
	if err := payload.VerifySignature(payloadPath); err != nil {
		return fmt.Errorf("payload verification failed: %w", err)
	}

	// Extract payload
	e.log.Info("Extracting payload")
	workDir, err := payload.Extract(payloadPath)
	if err != nil {
		return fmt.Errorf("failed to extract payload: %w", err)
	}
	e.workDir = workDir

	// Parse manifest
	e.log.Info("Parsing manifest")
	manifestPath, err := manifest.FindManifest(workDir)
	if err != nil {
		return fmt.Errorf("failed to find manifest: %w", err)
	}

	m, err := manifest.Parse(manifestPath)
	if err != nil {
		return fmt.Errorf("failed to parse manifest: %w", err)
	}
	e.manifest = m

	// Log execution details
	e.log.WithFields(logrus.Fields{
		"job_id":        m.Metadata.JobID,
		"event_id":      m.Metadata.EventID,
		"event_version": m.Metadata.EventVersion,
		"interpreter":   m.Interpreter,
		"entrypoint":    m.Entrypoint,
	}).Info("Starting script execution")

	// Setup runtime helpers
	if err := e.SetupHelpers(m); err != nil {
		return fmt.Errorf("failed to setup helpers: %w", err)
	}

	// Execute script
	if err := e.executeScript(); err != nil {
		var scriptExit *ScriptExitError
		if errors.As(err, &scriptExit) {
			return err
		}
		return fmt.Errorf("script execution failed: %w", err)
	}

	// In bundled mode nothing carries the script's output or condition back to
	// the app, so report them rather than lose them silently.
	if output, err := e.CollectHelperOutput(); err != nil {
		e.log.WithError(err).Warn("Failed to collect helper output")
	} else if output != nil {
		e.log.WithField("output", output).Warn("Collected helper output that could not reach the app")
	}
	if condition, err := e.CollectHelperCondition(); err != nil {
		e.log.WithError(err).Warn("Failed to collect helper condition")
	} else if condition != nil {
		e.log.WithField("condition", *condition).Warn("Collected workflow condition that could not reach the app")
	}

	e.log.Info("Script execution completed successfully")
	return nil
}

// executeScript runs the script based on the interpreter
func (e *Executor) executeScript() error {
	// Validate the entrypoint is a regular file contained in the work dir
	// (rejects `../` / absolute manifest entrypoints — HI-15).
	scriptPath, err := payload.ResolveEntrypoint(e.workDir, e.manifest.Entrypoint)
	if err != nil {
		return fmt.Errorf("invalid entrypoint: %w", err)
	}

	// Prepare command based on interpreter
	var cmd *exec.Cmd
	switch e.manifest.Interpreter {
	case types.ScriptTypeBash:
		// Create a wrapper script that sources the discovery script
		wrapperScript := fmt.Sprintf(`#!/bin/bash
source "%s/.cronium/discovery.sh"
exec bash "%s"`, e.workDir, scriptPath)
		cmd = exec.Command("bash", "-c", wrapperScript)
	case types.ScriptTypePython:
		// Create a wrapper that properly loads the discovery module and then executes the script
		// Using execfile or runpy to maintain the global namespace
		wrapperScript := fmt.Sprintf(`
import sys
import os
sys.path.insert(0, '%s/.cronium')

# Execute discovery script to set up cronium module
exec(open('%s/.cronium/discovery.py').read())

# Now execute the main script with cronium available
exec(open('%s').read())
`, e.workDir, e.workDir, scriptPath)
		cmd = exec.Command("python3", "-c", wrapperScript)
	case types.ScriptTypeNode:
		// Require the discovery module before executing the script
		wrapperScript := fmt.Sprintf(`require('%s/.cronium/discovery.js'); require('%s')`, e.workDir, scriptPath)
		cmd = exec.Command("node", "-e", wrapperScript)
	default:
		return fmt.Errorf("unsupported interpreter: %s", e.manifest.Interpreter)
	}

	// Set working directory
	cmd.Dir = e.workDir

	// Set environment variables
	cmd.Env = os.Environ()

	// Debug: Log initial environment
	e.log.Debug("Initial environment variables from os.Environ():")
	for _, env := range os.Environ() {
		if strings.HasPrefix(env, "CRONIUM_") {
			// Hide token value for security
			if strings.HasPrefix(env, "CRONIUM_API_TOKEN=") {
				e.log.Debugf("  %s=<hidden>", strings.Split(env, "=")[0])
			} else {
				e.log.Debugf("  %s", env)
			}
		}
	}

	for key, value := range e.manifest.Environment {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", key, value))
	}

	// Add Cronium-specific environment variables
	if e.manifest.Metadata.JobID != "" {
		cmd.Env = append(cmd.Env, fmt.Sprintf("CRONIUM_JOB_ID=%s", e.manifest.Metadata.JobID))
	} else if jobID := os.Getenv("CRONIUM_JOB_ID"); jobID != "" {
		// Pass through from parent environment if not in manifest
		cmd.Env = append(cmd.Env, fmt.Sprintf("CRONIUM_JOB_ID=%s", jobID))
	}

	cmd.Env = append(cmd.Env, fmt.Sprintf("CRONIUM_EVENT_ID=%s", e.manifest.Metadata.EventID))

	// Pass execution ID from parent environment or manifest
	// Prefer environment variable (from orchestrator) over manifest
	envExecID := os.Getenv("CRONIUM_EXECUTION_ID")
	manifestExecID := e.manifest.Metadata.ExecutionID

	if envExecID != "" {
		// Use execution ID from orchestrator (matches JWT)
		cmd.Env = append(cmd.Env, fmt.Sprintf("CRONIUM_EXECUTION_ID=%s", envExecID))
	} else if manifestExecID != "" {
		// Fall back to manifest only if no environment variable
		cmd.Env = append(cmd.Env, fmt.Sprintf("CRONIUM_EXECUTION_ID=%s", manifestExecID))
		e.log.Warn("Using execution ID from manifest as environment variable not set")
	}

	cmd.Env = append(cmd.Env, fmt.Sprintf("CRONIUM_WORK_DIR=%s", e.workDir))

	// Pass through helper-related environment variables if they exist. The
	// script also gets the names a container uses for the runtime API.
	if helperMode := os.Getenv("CRONIUM_HELPER_MODE"); helperMode != "" {
		cmd.Env = append(cmd.Env, fmt.Sprintf("CRONIUM_HELPER_MODE=%s", helperMode))
	}
	if apiEndpoint := os.Getenv("CRONIUM_API_ENDPOINT"); apiEndpoint != "" {
		cmd.Env = append(cmd.Env,
			fmt.Sprintf("CRONIUM_API_ENDPOINT=%s", apiEndpoint),
			fmt.Sprintf("CRONIUM_RUNTIME_API=%s", apiEndpoint),
		)
	}
	if apiToken := os.Getenv("CRONIUM_API_TOKEN"); apiToken != "" {
		cmd.Env = append(cmd.Env,
			fmt.Sprintf("CRONIUM_API_TOKEN=%s", apiToken),
			fmt.Sprintf("CRONIUM_EXECUTION_TOKEN=%s", apiToken),
		)
	}

	// require('cronium') resolves through NODE_PATH, as it does in a container.
	if e.manifest.Interpreter == types.ScriptTypeNode {
		nodePath := filepath.Join(e.workDir, ".cronium")
		if existing := os.Getenv("NODE_PATH"); existing != "" {
			nodePath += string(os.PathListSeparator) + existing
		}
		cmd.Env = append(cmd.Env, fmt.Sprintf("NODE_PATH=%s", nodePath))
	}

	// The script's output is the job's output, byte for byte, so it reads the
	// same as in a container.
	cmd.Stdout = e.stdout
	cmd.Stderr = e.stderr

	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return &ScriptExitError{Code: exitCode(exitErr)}
		}
		return fmt.Errorf("failed to run script: %w", err)
	}

	return nil
}

// exitCode returns a process's exit status, using the shell's 128+signal
// convention for one killed by a signal.
func exitCode(err *exec.ExitError) int {
	if status, ok := err.Sys().(syscall.WaitStatus); ok && status.Signaled() {
		return 128 + int(status.Signal())
	}
	return err.ExitCode()
}

// setupSignalHandling sets up signal handlers for cleanup
func (e *Executor) setupSignalHandling() {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigChan
		e.log.Warn("Received interrupt signal, cleaning up")
		e.Cleanup()
		os.Exit(1)
	}()
}

// Cleanup removes the working directory
func (e *Executor) Cleanup() error {
	e.cleanupMu.Lock()
	defer e.cleanupMu.Unlock()

	if e.cleaned || e.workDir == "" {
		return nil
	}

	e.log.WithField("dir", e.workDir).Debug("Cleaning up work directory")
	if err := payload.Cleanup(e.workDir); err != nil {
		return fmt.Errorf("cleanup failed: %w", err)
	}

	e.cleaned = true
	return nil
}

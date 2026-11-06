package container

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	cerrdefs "github.com/containerd/errdefs"
	"github.com/golang-jwt/jwt/v5"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"github.com/sirupsen/logrus"
)

// A job's containers don't depend on the process that started them, so a restart
// of the orchestrator doesn't have to end the job. This file is how the next
// process finds them again: everything it needs is on the containers themselves,
// and nothing is written to the orchestrator's own disk.
//
// A job's script runs at most once for a claim: a container whose lease is still
// held is followed to its end, and one whose lease is gone is removed, because
// the job may already be running again somewhere else.

// Labels on every job container, sidecar and network, read back after a restart.
const (
	labelManaged        = "cronium.managed"
	labelType           = "cronium.type"
	labelJobID          = "cronium.job.id"
	labelOrchestratorID = "cronium.orchestrator.id"
	// labelStack keeps two stacks on one Docker host apart when they share an
	// orchestrator ID, as any two compose stacks left on the default do. Its value
	// is the stack's shared network, which two working stacks can't have in common:
	// each resolves its app by name on that network.
	labelStack = "cronium.stack"

	// labelTimeoutSeconds is how long the script may run. Without it a later
	// process couldn't stop a job that outlives its timeout.
	labelTimeoutSeconds = "cronium.job.timeout-seconds"
	// labelResumable is "false" on a job a later process must not follow.
	labelResumable = "cronium.job.resumable"

	containerTypeJob     = "job"
	containerTypeSidecar = "sidecar"
)

// reportHoldLimit bounds how long a finished job's containers wait for the core
// to report its result. It has to clear a report that spends its whole budget
// failing and ends up in the spool, and exists so that a call that never comes
// can't leave containers behind.
const reportHoldLimit = 2 * time.Minute

// jobResources is what one job has on the Docker host. Each is empty if absent.
type jobResources struct {
	containerID string
	sidecarID   string
	networkID   string
}

// resultHold keeps a finished job's containers until its result has been reported.
type resultHold struct {
	release chan struct{}
	removed chan struct{}
}

// managedLabels returns the labels marking a resource as this stack's.
func (e *Executor) managedLabels(jobID, resourceType string) map[string]string {
	labels := map[string]string{
		labelManaged:        "true",
		labelJobID:          jobID,
		labelOrchestratorID: e.orchestratorID,
		labelStack:          e.config.Runtime.SharedNetwork,
	}
	if resourceType != "" {
		labels[labelType] = resourceType
	}
	return labels
}

// jobContainerLabels returns the labels of the container running a job's script.
func (e *Executor) jobContainerLabels(job *types.Job) map[string]string {
	labels := e.managedLabels(job.ID, containerTypeJob)
	labels[labelTimeoutSeconds] = strconv.Itoa(int(e.executionTimeout(job).Seconds()))
	if job.LocalBranch {
		labels[labelResumable] = "false"
	}
	return labels
}

// executionTimeout is how long a job's script may run, after the system-wide cap.
func (e *Executor) executionTimeout(job *types.Job) time.Duration {
	timeout := job.GetTimeout()
	if limit := e.timeoutConfig.MaxExecutionTimeout; limit > 0 && timeout > limit {
		return limit
	}
	return timeout
}

// ownedResourceFilters selects the resources of this orchestrator in this stack.
func (e *Executor) ownedResourceFilters() client.Filters {
	return make(client.Filters).Add("label",
		labelManaged+"=true",
		labelOrchestratorID+"="+e.orchestratorID,
		labelStack+"="+e.config.Runtime.SharedNetwork,
	)
}

// foreignToThisStack reports whether a resource belongs to another orchestrator
// or stack on this host. A resource with no orchestrator label predates the label,
// so no process can claim it by label and it isn't treated as anyone else's.
func (e *Executor) foreignToThisStack(labels map[string]string) bool {
	id, labelled := labels[labelOrchestratorID]
	if !labelled {
		return false
	}
	return id != e.orchestratorID || labels[labelStack] != e.config.Runtime.SharedNetwork
}

// FindLeftoverJobs lists what an earlier process of this orchestrator left on the
// host. It changes nothing, and is called before this process claims any job.
func (e *Executor) FindLeftoverJobs(ctx context.Context) ([]types.LeftoverJob, error) {
	listed, err := e.dockerClient.ContainerList(ctx, client.ContainerListOptions{
		All:     true,
		Filters: e.ownedResourceFilters(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}
	networks, err := e.dockerClient.NetworkList(ctx, client.NetworkListOptions{
		Filters: e.ownedResourceFilters(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list networks: %w", err)
	}

	resources := make(map[string]*jobResources)
	of := func(jobID string) *jobResources {
		if resources[jobID] == nil {
			resources[jobID] = &jobResources{}
		}
		return resources[jobID]
	}
	for _, c := range listed.Items {
		jobID := c.Labels[labelJobID]
		if jobID == "" {
			continue
		}
		switch c.Labels[labelType] {
		case containerTypeJob:
			of(jobID).containerID = c.ID
		case containerTypeSidecar:
			of(jobID).sidecarID = c.ID
		}
	}
	for _, n := range networks.Items {
		if jobID := n.Labels[labelJobID]; jobID != "" {
			of(jobID).networkID = n.ID
		}
	}

	found := make([]types.LeftoverJob, 0, len(resources))
	for jobID, res := range resources {
		leftover := types.LeftoverJob{ID: jobID}
		if res.containerID != "" {
			info, err := e.dockerClient.ContainerInspect(ctx, res.containerID, client.ContainerInspectOptions{})
			switch {
			case err == nil:
				leftover.Job = resumableJob(jobID, info.Container, e.log)
			case !isNotFound(err):
				return nil, fmt.Errorf("failed to inspect the container of job %s: %w", jobID, err)
			}
		}
		found = append(found, leftover)
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	for jobID, res := range resources {
		e.leftovers[jobID] = *res
	}
	return found, nil
}

// resumableJob rebuilds what the core needs to follow and report a job from its
// container, or returns nil if a later process can't finish this job.
func resumableJob(jobID string, info container.InspectResponse, log *logrus.Logger) *types.Job {
	entry := log.WithField("jobID", jobID)
	if info.State == nil || info.Config == nil {
		entry.Warn("Found a job container with no state; removing it")
		return nil
	}
	if info.Config.Labels[labelResumable] == "false" {
		return nil
	}
	// The script was never started, or is being torn down. There's no result here.
	switch info.State.Status {
	case container.StateCreated, container.StateRemoving:
		return nil
	}
	startedAt, err := time.Parse(time.RFC3339Nano, info.State.StartedAt)
	if err != nil {
		entry.WithError(err).Warn("Found a job container with no start time; removing it")
		return nil
	}
	claims, err := executionClaimsFromEnv(info.Config.Env)
	if err != nil {
		entry.WithError(err).Warn("Found a job container whose result can't be reported; removing it")
		return nil
	}
	timeoutSeconds, err := strconv.Atoi(info.Config.Labels[labelTimeoutSeconds])
	if err != nil || timeoutSeconds <= 0 {
		entry.WithError(err).Warn("Found a job container with no timeout; removing it")
		return nil
	}
	timeout := time.Duration(timeoutSeconds) * time.Second
	return &types.Job{
		ID:              jobID,
		Type:            types.JobTypeContainer,
		CapabilityToken: claims.Capability,
		StartedAt:       &startedAt,
		Timeout:         timeout,
		Execution: types.ExecutionConfig{
			Target:  types.Target{Type: types.TargetTypeLocal},
			Timeout: timeout,
		},
		Metadata: map[string]any{"executionId": claims.ExecutionID},
	}
}

// executionClaimsFromEnv reads a job's execution id and capability token out of
// the token in its container's environment. The signature isn't checked, because
// JWT_SECRET may be what the restart changed. It doesn't need to be: a script
// can't alter what Docker reports as its environment, and the app verifies the
// capability when it's presented.
func executionClaimsFromEnv(env []string) (*ExecutionClaims, error) {
	var tokenString string
	for _, entry := range env {
		if value, ok := strings.CutPrefix(entry, "CRONIUM_EXECUTION_TOKEN="); ok {
			tokenString = value
			break
		}
	}
	if tokenString == "" {
		return nil, errors.New("no execution token in the container's environment")
	}
	claims := &ExecutionClaims{}
	if _, _, err := jwt.NewParser().ParseUnverified(tokenString, claims); err != nil {
		return nil, fmt.Errorf("unreadable execution token: %w", err)
	}
	if claims.Capability == "" || claims.ExecutionID == "" {
		return nil, errors.New("execution token has no capability or execution id")
	}
	return claims, nil
}

// RemoveLeftoverJob removes what FindLeftoverJobs found for a job. A script still
// running is killed: its lease is gone, so the job may already be running again.
func (e *Executor) RemoveLeftoverJob(ctx context.Context, jobID string) error {
	e.mu.Lock()
	res := e.leftovers[jobID]
	delete(e.leftovers, jobID)
	e.mu.Unlock()
	return e.removeResources(ctx, res)
}

// removeStaleResources removes anything an earlier attempt of a job left under
// the names this attempt is about to use. Having just claimed the job makes these
// stale by definition, whichever process made them, and leaving them would fail
// this attempt on a name conflict.
func (e *Executor) removeStaleResources(ctx context.Context, jobID string) error {
	var errs []error
	for _, name := range []string{jobContainerName(jobID), sidecarContainerName(jobID)} {
		if _, err := e.dockerClient.ContainerRemove(ctx, name, client.ContainerRemoveOptions{Force: true}); err != nil && !isNotFound(err) {
			errs = append(errs, err)
		}
	}
	if _, err := e.dockerClient.NetworkRemove(ctx, jobNetworkName(jobID), client.NetworkRemoveOptions{}); err != nil && !isNotFound(err) {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

// removeResources removes a job's containers and then its network, which can't
// go while a container is attached. Something already gone isn't a failure.
func (e *Executor) removeResources(ctx context.Context, res jobResources) error {
	var errs []error
	if res.containerID != "" {
		if err := e.removeContainer(ctx, res.containerID); err != nil && !isNotFound(err) {
			errs = append(errs, fmt.Errorf("failed to remove container: %w", err))
		}
	}
	if res.sidecarID != "" {
		if err := e.sidecar.StopSidecar(ctx, res.sidecarID); err != nil && !isNotFound(err) {
			errs = append(errs, fmt.Errorf("failed to remove sidecar: %w", err))
		}
	}
	if res.networkID != "" {
		if err := e.sidecar.RemoveJobNetwork(ctx, res.networkID); err != nil && !isNotFound(err) {
			errs = append(errs, fmt.Errorf("failed to remove network: %w", err))
		}
	}
	return errors.Join(errs...)
}

// ResumeJob follows a job FindLeftoverJobs found, to its end. A running script keeps
// the timeout it started with, so one that ran past it while no orchestrator was
// watching is stopped at once.
func (e *Executor) ResumeJob(ctx context.Context, job *types.Job) (<-chan types.ExecutionUpdate, error) {
	e.mu.Lock()
	res, ok := e.leftovers[job.ID]
	delete(e.leftovers, job.ID)
	if ok {
		e.containers[job.ID] = res.containerID
		if res.sidecarID != "" {
			e.sidecars[job.ID] = res.sidecarID
		}
		if res.networkID != "" {
			e.networks[job.ID] = res.networkID
		}
	}
	e.mu.Unlock()
	if !ok || res.containerID == "" {
		return nil, fmt.Errorf("no container found for job %s", job.ID)
	}

	executionID, _ := job.Metadata["executionId"].(string)
	updates := make(chan types.ExecutionUpdate, 100)
	e.setHandOver(job.ID, true)

	go func() {
		execCtx := ctx
		if !e.containerStopped(ctx, res.containerID) {
			var cancel context.CancelFunc
			execCtx, cancel = context.WithDeadline(ctx, job.StartedAt.Add(job.GetTimeout()))
			defer cancel()
		}

		timing := &ExecutionTiming{ExecutionStart: *job.StartedAt}
		keepForReport := e.superviseContainer(execCtx, res.containerID, job, updates, executionID, timing)
		e.finishRun(ctx, job, res, updates, keepForReport)
	}()

	return updates, nil
}

// containerStopped reports whether Docker says a container has stopped. A script
// that stopped by itself keeps its result however late this process finds it: it
// isn't timed out just because no orchestrator was there to see it end in time.
func (e *Executor) containerStopped(ctx context.Context, containerID string) bool {
	inspect, err := e.dockerClient.ContainerInspect(ctx, containerID, client.ContainerInspectOptions{})
	return err == nil && inspect.Container.State != nil && !inspect.Container.State.Running
}

// addResumedTiming adds the timing a process that only saw the end of a run can vouch
// for. Setup timing came from the process that did the setup, and isn't overwritten.
func addResumedTiming(update *api.ExecutionStatusUpdate, timing *ExecutionTiming) {
	duration := timing.GetExecutionDuration()
	update.ExecutionStartedAt = &timing.ExecutionStart
	update.ExecutionCompletedAt = &timing.ExecutionEnd
	update.CompletedAt = &timing.ExecutionEnd
	update.ExecutionDuration = &duration
}

// finishRun ends a run's update stream and removes its containers and network. A
// container that ran to its end is the only copy of the result until the core has
// reported it, so it stays until ReleaseJob: a process stopped before then leaves
// the next one a finished container to report, rather than nothing.
func (e *Executor) finishRun(ctx context.Context, job *types.Job, res jobResources, updates chan types.ExecutionUpdate, keepForReport bool) {
	cleanup := func() {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), e.timeoutConfig.CleanupTimeout)
		defer cancel()
		if err := e.removeResources(cleanupCtx, res); err != nil {
			e.log.WithError(err).WithField("jobID", job.ID).Error("Failed to remove the job's containers")
		}
		e.mu.Lock()
		delete(e.containers, job.ID)
		delete(e.sidecars, job.ID)
		delete(e.networks, job.ID)
		delete(e.handOver, job.ID)
		e.mu.Unlock()
	}

	// Nothing to keep for a cancelled script, which should stop now, or for the local
	// half of a larger job, which no later process can report.
	if !keepForReport || job.LocalBranch {
		cleanup()
		close(updates)
		return
	}

	hold := &resultHold{release: make(chan struct{}), removed: make(chan struct{})}
	e.mu.Lock()
	e.holds[job.ID] = hold
	e.mu.Unlock()

	close(updates)

	select {
	case <-hold.release:
	case <-time.After(e.holdLimit()):
		e.log.WithField("jobID", job.ID).Warn("Nothing reported this job's result in time; removing its containers")
	}
	cleanup()
	e.mu.Lock()
	delete(e.holds, job.ID)
	e.mu.Unlock()
	close(hold.removed)
}

func (e *Executor) holdLimit() time.Duration {
	if e.reportHoldLimit > 0 {
		return e.reportHoldLimit
	}
	return reportHoldLimit
}

// ReleaseJob says a job's result has been reported or spooled. It returns once the
// job's containers are gone, so a slot isn't freed while they're still being
// removed. A job with nothing held returns at once.
func (e *Executor) ReleaseJob(jobID string) {
	e.mu.Lock()
	hold := e.holds[jobID]
	if hold != nil {
		select {
		case <-hold.release:
		default:
			close(hold.release)
		}
	}
	e.mu.Unlock()
	if hold != nil {
		<-hold.removed
	}
}

// CanHandOver reports whether the next process can take over a job, so this one
// needn't wait for it. That holds from the script's start until its containers go,
// which covers reporting: if this process stops before a report lands, the next one
// finds the stopped container and reports it instead.
func (e *Executor) CanHandOver(jobID string) bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.handOver[jobID]
}

func (e *Executor) setHandOver(jobID string, can bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if can {
		e.handOver[jobID] = true
	} else {
		delete(e.handOver, jobID)
	}
}

func isNotFound(err error) bool {
	return cerrdefs.IsNotFound(err)
}

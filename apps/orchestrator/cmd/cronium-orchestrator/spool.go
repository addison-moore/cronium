package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/internal/api"
	cerrors "github.com/addison-moore/cronium/apps/orchestrator/pkg/errors"
	"github.com/sirupsen/logrus"
)

// spooledCompletion is the on-disk form of an undeliverable completion report
type spooledCompletion struct {
	JobID    string                  `json:"jobId"`
	Complete *api.CompleteJobRequest `json:"complete"`
	SpooledA string                  `json:"spooledAt"`
	// CapabilityToken (HI-10) is persisted so a retry — possibly after a
	// restart — can still authenticate to the job-scoped completion route. If
	// it has expired by retry time the route returns 403, which the retry loop
	// treats as superseded (the sweeper will finalize the job).
	CapabilityToken string `json:"capabilityToken,omitempty"`
}

func (c *daemonCore) spoolCompletion(jobID string, req *api.CompleteJobRequest, capabilityToken string) {
	if c.spoolDir == "" {
		c.log.WithField("jobID", jobID).Error("No spool dir; completion lost (sweeper will finalize the job at lease expiry)")
		return
	}
	data, err := json.Marshal(&spooledCompletion{
		JobID:           jobID,
		Complete:        req,
		SpooledA:        time.Now().Format(time.RFC3339),
		CapabilityToken: capabilityToken,
	})
	if err != nil {
		c.log.WithError(err).WithField("jobID", jobID).Error("Failed to marshal completion for spool")
		return
	}
	path := filepath.Join(c.spoolDir, fmt.Sprintf("%s-%d.json", jobID, time.Now().UnixNano()))
	if err := os.WriteFile(path, data, 0o644); err != nil {
		c.log.WithError(err).WithField("jobID", jobID).Error("Failed to write completion spool file")
		return
	}
	c.log.WithFields(logrus.Fields{"jobID": jobID, "path": path}).Info("Completion spooled for retry")
}

// spoolRetryLoop retries spooled completions once a minute. A file is removed
// when the app accepts the report — including the idempotent "already in that
// terminal state" case; a 409 conflict (the sweeper resolved the job
// differently in the meantime) also removes it, since the authoritative state
// has moved on.
func (c *daemonCore) spoolRetryLoop(ctx context.Context) {
	if c.spoolDir == "" {
		return
	}
	ticker := time.NewTicker(c.spoolRetryInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.drainSpoolOnce(ctx)
		}
	}
}

// drainSpoolOnce makes a single pass over the spool dir, retrying every
// spooled completion and removing the ones that are delivered or superseded.
func (c *daemonCore) drainSpoolOnce(ctx context.Context) {
	entries, err := os.ReadDir(c.spoolDir)
	if err != nil {
		c.log.WithError(err).Warn("Failed to read completion spool dir")
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		path := filepath.Join(c.spoolDir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var spooled spooledCompletion
		if err := json.Unmarshal(data, &spooled); err != nil {
			c.log.WithField("path", path).Warn("Removing unparseable spool file")
			_ = os.Remove(path)
			continue
		}
		reportCtx, cancel := context.WithTimeout(
			c.withCapability(ctx, spooled.CapabilityToken),
			c.spoolReportTimeout,
		)
		err = c.api.CompleteJob(reportCtx, spooled.JobID, spooled.Complete)
		cancel()
		if err == nil {
			c.log.WithField("jobID", spooled.JobID).Info("Delivered spooled completion")
			_ = os.Remove(path)
			continue
		}
		// 409/404 mean the app already finalized the job differently
		// (sweeper); 403 means the capability token expired before the
		// retry landed — in every case our report is moot and the job
		// is (or will be) resolved by the sweeper, so drop the spool.
		var apiErr *cerrors.APIError
		if errors.As(err, &apiErr) &&
			(apiErr.StatusCode == 409 || apiErr.StatusCode == 404 || apiErr.StatusCode == 403) {
			c.log.WithFields(logrus.Fields{"jobID": spooled.JobID, "status": apiErr.StatusCode}).
				Warn("Spooled completion superseded; dropping")
			_ = os.Remove(path)
			continue
		}
		c.log.WithError(err).WithField("jobID", spooled.JobID).Debug("Spooled completion still undeliverable")
	}
}

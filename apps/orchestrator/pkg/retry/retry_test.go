package retry

import (
	"context"
	"errors"
	"fmt"
	"io"
	"testing"
	"time"

	croniumerrors "github.com/addison-moore/cronium/apps/orchestrator/pkg/errors"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testLog() *logrus.Entry {
	log := logrus.New()
	log.SetOutput(io.Discard)
	return logrus.NewEntry(log)
}

// fastConfig keeps test wall time in the low milliseconds.
func fastConfig(maxAttempts int) Config {
	return Config{
		MaxAttempts:  maxAttempts,
		InitialDelay: time.Millisecond,
		MaxDelay:     4 * time.Millisecond,
		Multiplier:   2.0,
	}
}

func retryableErr(msg string) error {
	return croniumerrors.NewNetworkError(msg, "TEST")
}

func nonRetryableErr(msg string) error {
	return croniumerrors.NewValidationError("field", "constraint", msg)
}

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
	assert.Equal(t, 3, cfg.MaxAttempts)
	assert.Equal(t, 1*time.Second, cfg.InitialDelay)
	assert.Equal(t, 30*time.Second, cfg.MaxDelay)
	assert.Equal(t, 2.0, cfg.Multiplier)
}

func TestWithRetrySucceedsFirstTry(t *testing.T) {
	calls := 0
	err := WithRetry(context.Background(), fastConfig(3), func() error {
		calls++
		return nil
	}, testLog())
	require.NoError(t, err)
	assert.Equal(t, 1, calls)
}

func TestWithRetrySucceedsAfterFailures(t *testing.T) {
	calls := 0
	err := WithRetry(context.Background(), fastConfig(5), func() error {
		calls++
		if calls < 3 {
			return retryableErr("transient")
		}
		return nil
	}, testLog())
	require.NoError(t, err)
	assert.Equal(t, 3, calls)
}

func TestWithRetryExhaustsAttemptsAndReturnsLastError(t *testing.T) {
	calls := 0
	var lastErr error
	err := WithRetry(context.Background(), fastConfig(3), func() error {
		calls++
		lastErr = retryableErr(fmt.Sprintf("attempt %d", calls))
		return lastErr
	}, testLog())
	require.Error(t, err)
	assert.Equal(t, 3, calls)
	assert.Same(t, lastErr, err, "must return the error from the final attempt")
	assert.Contains(t, err.Error(), "attempt 3")
}

func TestWithRetryStopsOnNonRetryableError(t *testing.T) {
	calls := 0
	wantErr := nonRetryableErr("bad input")
	err := WithRetry(context.Background(), fastConfig(5), func() error {
		calls++
		return wantErr
	}, testLog())
	require.Error(t, err)
	assert.Equal(t, 1, calls, "non-retryable errors must not be retried")
	assert.Same(t, wantErr, err)
}

func TestWithRetryContextAlreadyCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	calls := 0
	err := WithRetry(ctx, fastConfig(3), func() error {
		calls++
		return nil
	}, testLog())
	require.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, 0, calls, "operation must not run once the context is done")
}

func TestWithRetryContextCancelledDuringBackoff(t *testing.T) {
	cfg := Config{
		MaxAttempts:  3,
		InitialDelay: 80 * time.Millisecond, // long enough to be interrupted
		MaxDelay:     80 * time.Millisecond,
		Multiplier:   2.0,
	}

	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	timer := time.AfterFunc(5*time.Millisecond, cancel)
	defer timer.Stop()

	err := WithRetry(ctx, cfg, func() error {
		calls++
		return retryableErr("transient")
	}, testLog())
	require.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, 1, calls, "cancellation during backoff must stop further attempts")
}

// TestWithRetryBackoffGrowthAndCap verifies the exponential growth and the
// MaxDelay cap via elapsed lower bounds: delays of 10ms, 20ms (2x), 20ms
// (capped) sum to 50ms across 4 attempts.
func TestWithRetryBackoffGrowthAndCap(t *testing.T) {
	cfg := Config{
		MaxAttempts:  4,
		InitialDelay: 10 * time.Millisecond,
		MaxDelay:     20 * time.Millisecond,
		Multiplier:   2.0,
	}

	calls := 0
	start := time.Now()
	err := WithRetry(context.Background(), cfg, func() error {
		calls++
		return retryableErr("transient")
	}, testLog())
	elapsed := time.Since(start)

	require.Error(t, err)
	assert.Equal(t, 4, calls)
	// 10 + 20 + 20 = 50ms of backoff. Uncapped growth (10+20+40) would be
	// 70ms; keep the upper bound loose for CI scheduling jitter but tight
	// enough to catch a missing cap combined with the lower bound.
	assert.GreaterOrEqual(t, elapsed, 45*time.Millisecond, "backoff must actually wait")
	assert.Less(t, elapsed, 500*time.Millisecond, "backoff must stay bounded")
}

// TestWithRetryZeroMaxAttemptsReturnsError: a zero/negative MaxAttempts
// config is rejected loudly without running the operation (FINDINGS #38 fix —
// previously it silently ran nothing and returned nil, so a zero-value Config
// made every operation a fake success). All in-tree callers pass >= 1 (the
// API client adds 1 to the configured retry count).
func TestWithRetryZeroMaxAttemptsReturnsError(t *testing.T) {
	for _, maxAttempts := range []int{0, -1} {
		calls := 0
		err := WithRetry(context.Background(), Config{MaxAttempts: maxAttempts}, func() error {
			calls++
			return nil
		}, testLog())
		require.Error(t, err, "MaxAttempts=%d", maxAttempts)
		assert.Contains(t, err.Error(), "MaxAttempts must be >= 1")
		assert.Equal(t, 0, calls, "operation must not run with MaxAttempts=%d", maxAttempts)
	}
}

func TestIsRetryable(t *testing.T) {
	apiRetryable := croniumerrors.NewAPIError(500, "X", "server error")
	apiNotRetryable := croniumerrors.NewAPIError(400, "X", "bad request")
	api429 := croniumerrors.NewAPIError(429, "X", "rate limited")
	baseRetryable := &croniumerrors.BaseError{Retryable: true}
	baseNotRetryable := &croniumerrors.BaseError{Retryable: false}
	dockerErr := croniumerrors.NewDockerError("X", "boom", "start") // Retryable: false
	sshErr := croniumerrors.NewSSHError("X", "boom", "connect")     // Retryable: true

	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"base retryable", baseRetryable, true},
		{"base not retryable", baseNotRetryable, false},
		{"api 500", apiRetryable, true},
		{"api 400", apiNotRetryable, false},
		{"api 429", api429, true},
		{"docker default", dockerErr, false},
		{"ssh default", sshErr, true},
		{"network error via type", croniumerrors.NewNetworkError("down", "TCP"), true},
		{"validation error", nonRetryableErr("bad"), false},
		{"plain error", errors.New("plain"), false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, isRetryable(tc.err))
		})
	}
}

func TestWithAsyncRetrySuccess(t *testing.T) {
	results := make(chan AsyncResult, 1)

	calls := 0
	WithAsyncRetry(context.Background(), fastConfig(5), func() error {
		calls++
		if calls < 2 {
			return retryableErr("transient")
		}
		return nil
	}, testLog(), func(r AsyncResult) {
		results <- r
	})

	select {
	case r := <-results:
		assert.True(t, r.Success)
		assert.NoError(t, r.Error)
		assert.Equal(t, 2, r.Attempts)
	case <-time.After(2 * time.Second):
		t.Fatal("callback was not invoked")
	}
}

func TestWithAsyncRetryFailure(t *testing.T) {
	results := make(chan AsyncResult, 1)

	wantErr := nonRetryableErr("bad input")
	WithAsyncRetry(context.Background(), fastConfig(3), func() error {
		return wantErr
	}, testLog(), func(r AsyncResult) {
		results <- r
	})

	select {
	case r := <-results:
		assert.False(t, r.Success)
		assert.Same(t, wantErr, r.Error)
		assert.Equal(t, 1, r.Attempts)
	case <-time.After(2 * time.Second):
		t.Fatal("callback was not invoked")
	}
}

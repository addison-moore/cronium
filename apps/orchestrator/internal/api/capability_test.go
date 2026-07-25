package api

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWithJobCapabilityRoundTrip(t *testing.T) {
	ctx := WithJobCapability(context.Background(), "cap.1.payload.sig")
	assert.Equal(t, "cap.1.payload.sig", jobCapabilityFromContext(ctx))
}

func TestWithJobCapabilityEmptyTokenIsNoop(t *testing.T) {
	base := context.Background()
	ctx := WithJobCapability(base, "")
	// Fail closed: an empty token must not be stored, so the request carries
	// no X-Job-Capability header and the app rejects it.
	assert.Equal(t, base, ctx, "empty token must return the original context")
	assert.Empty(t, jobCapabilityFromContext(ctx))
}

func TestJobCapabilityFromContextMissing(t *testing.T) {
	assert.Empty(t, jobCapabilityFromContext(context.Background()))
}

func TestWithJobCapabilityOverwrite(t *testing.T) {
	ctx := WithJobCapability(context.Background(), "cap.1.old.sig")
	ctx = WithJobCapability(ctx, "cap.1.new.sig")
	assert.Equal(t, "cap.1.new.sig", jobCapabilityFromContext(ctx))
}

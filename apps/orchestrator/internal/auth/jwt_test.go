package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateJobToken_OutlivesTheJob(t *testing.T) {
	m := NewJWTManager("test-secret")
	lifetime := 5 * time.Hour

	raw, err := m.GenerateJobToken("job-1", "exec-1", "user-1", "42", "cap-token", lifetime)
	require.NoError(t, err)

	claims := &Claims{}
	_, err = jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (interface{}, error) {
		return []byte("test-secret"), nil
	})
	require.NoError(t, err)

	assert.Equal(t, "job-1", claims.JobID)
	assert.Equal(t, "exec-1", claims.ExecutionID)
	assert.Equal(t, "cap-token", claims.Capability)
	// Used to be a fixed hour, whatever the job's own timeout was.
	assert.WithinDuration(t, time.Now().Add(lifetime), claims.ExpiresAt.Time, 5*time.Second)
}

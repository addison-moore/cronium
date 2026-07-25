package container

import (
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/orchestrator/pkg/types"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSecret = "unit-test-secret"

func TestGenerateJWT_RoundTrip(t *testing.T) {
	token, err := generateJWT("exec-1", "job-1", testSecret, "user-1", "42", "cap-token", 3*time.Hour)
	require.NoError(t, err)
	require.NotEmpty(t, token)

	claims, err := validateJWT(token, testSecret)
	require.NoError(t, err)

	assert.Equal(t, "exec-1", claims.ExecutionID)
	assert.Equal(t, "job-1", claims.JobID)
	assert.Equal(t, "user-1", claims.UserID)
	assert.Equal(t, "42", claims.EventID)
	assert.Equal(t, "execution", claims.Scope)
	assert.Equal(t, "cap-token", claims.Capability)
	assert.Equal(t, "job:job-1", claims.Subject)
	assert.Equal(t, "cronium-orchestrator", claims.Issuer)
}

func TestGenerateJWT_EmptySecretFails(t *testing.T) {
	_, err := generateJWT("exec-1", "job-1", "", "u", "e", "", time.Hour)
	require.ErrorContains(t, err, "JWT secret not configured")
}

func TestGenerateJWT_EnforcesMinimumTwoHourLifetime(t *testing.T) {
	token, err := generateJWT("exec-1", "job-1", testSecret, "", "", "", time.Minute)
	require.NoError(t, err)

	claims, err := validateJWT(token, testSecret)
	require.NoError(t, err)
	require.NotNil(t, claims.ExpiresAt)

	// A too-short lifetime is raised to 2h so late cronium.output() calls
	// don't get a 401 mid-execution.
	expiresIn := time.Until(claims.ExpiresAt.Time)
	assert.Greater(t, expiresIn, 119*time.Minute)
	assert.Less(t, expiresIn, 121*time.Minute)
}

func TestGenerateJWT_LongLifetimeHonored(t *testing.T) {
	token, err := generateJWT("exec-1", "job-1", testSecret, "", "", "", 5*time.Hour)
	require.NoError(t, err)

	claims, err := validateJWT(token, testSecret)
	require.NoError(t, err)
	expiresIn := time.Until(claims.ExpiresAt.Time)
	assert.Greater(t, expiresIn, 4*time.Hour+59*time.Minute)
	assert.Less(t, expiresIn, 5*time.Hour+time.Minute)
}

func TestValidateJWT_WrongSecretFails(t *testing.T) {
	token, err := generateJWT("exec-1", "job-1", testSecret, "", "", "", time.Hour)
	require.NoError(t, err)

	_, err = validateJWT(token, "a-different-secret")
	require.Error(t, err)
}

func TestValidateJWT_RejectsNonHMACAlgorithm(t *testing.T) {
	claims := ExecutionClaims{
		ExecutionID: "exec-1",
		JobID:       "job-1",
		Scope:       "execution",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	unsigned := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	token, err := unsigned.SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	_, err = validateJWT(token, testSecret)
	require.Error(t, err, "alg=none token must be rejected")
}

func TestValidateJWT_ExpiredTokenFails(t *testing.T) {
	claims := ExecutionClaims{
		ExecutionID: "exec-1",
		JobID:       "job-1",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	require.NoError(t, err)

	_, err = validateJWT(token, testSecret)
	require.Error(t, err)
}

func TestGenerateExecutionToken_MetadataVariants(t *testing.T) {
	tests := []struct {
		name       string
		metadata   map[string]any
		wantUserID string
		wantEvent  string
	}{
		{"float64 eventId (JSON decoding)", map[string]any{"userId": "u1", "eventId": float64(7)}, "u1", "7"},
		{"int eventId", map[string]any{"userId": "u2", "eventId": 8}, "u2", "8"},
		{"string eventId", map[string]any{"userId": "u3", "eventId": "9"}, "u3", "9"},
		{"missing metadata", nil, "", ""},
		{"wrong-typed userId ignored", map[string]any{"userId": 12}, "", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			e := newUnitExecutor()
			job := scriptJob(types.ScriptTypeBash)
			job.Metadata = tc.metadata

			token, err := e.sidecar.generateExecutionToken(job)
			require.NoError(t, err)

			claims, err := validateJWT(token, testSecret)
			require.NoError(t, err)
			assert.Equal(t, tc.wantUserID, claims.UserID)
			assert.Equal(t, tc.wantEvent, claims.EventID)
			// Without a stored execution ID the claim falls back to the job ID.
			assert.Equal(t, job.ID, claims.ExecutionID)
		})
	}
}

func TestGenerateExecutionToken_UsesStoredExecutionID(t *testing.T) {
	e := newUnitExecutor()
	job := scriptJob(types.ScriptTypeBash)
	e.executionIDs[job.ID] = "exec_job-1_9999"

	token, err := e.sidecar.generateExecutionToken(job)
	require.NoError(t, err)

	claims, err := validateJWT(token, testSecret)
	require.NoError(t, err)
	assert.Equal(t, "exec_job-1_9999", claims.ExecutionID,
		"JWT claim must carry the same id exported as CRONIUM_EXECUTION_ID")
}

func TestExecutionTokenStoreAndGet(t *testing.T) {
	e := newUnitExecutor()

	_, err := e.sidecar.getExecutionToken("missing")
	require.ErrorContains(t, err, "no token found")

	e.sidecar.storeExecutionToken("job-1", "tok-1")
	got, err := e.sidecar.getExecutionToken("job-1")
	require.NoError(t, err)
	assert.Equal(t, "tok-1", got)

	// storeExecutionToken lazily initializes a nil map.
	e.tokens = nil
	e.sidecar.storeExecutionToken("job-2", "tok-2")
	got, err = e.sidecar.getExecutionToken("job-2")
	require.NoError(t, err)
	assert.Equal(t, "tok-2", got)
}

func TestGetRuntimeImage(t *testing.T) {
	e := newUnitExecutor()
	assert.Equal(t, "cronium/runtime-api:latest", e.sidecar.getRuntimeImage())

	e.config.Runtime.Image = "custom/runtime:2"
	assert.Equal(t, "custom/runtime:2", e.sidecar.getRuntimeImage())
}

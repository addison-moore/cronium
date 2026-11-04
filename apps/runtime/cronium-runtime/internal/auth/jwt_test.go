package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/addison-moore/cronium/apps/runtime/internal/config"
)

func newManager() *JWTManager {
	return NewJWTManager(config.AuthConfig{
		JWTSecret: "test-secret-at-least-32-characters-long!!",
	})
}

// sign mints a token the way the orchestrator does.
func sign(t *testing.T, m *JWTManager, claims *Claims) string {
	t.Helper()
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func registered(issued, expires time.Time) jwt.RegisteredClaims {
	return jwt.RegisteredClaims{
		IssuedAt:  jwt.NewNumericDate(issued),
		ExpiresAt: jwt.NewNumericDate(expires),
	}
}

func TestValidateFreshToken(t *testing.T) {
	m := newManager()
	now := time.Now()
	claims, err := m.ValidateToken(sign(t, m, &Claims{
		JobID:            "job-1",
		ExecutionID:      "exec-1",
		RegisteredClaims: registered(now, now.Add(time.Hour)),
	}))
	if err != nil {
		t.Fatalf("fresh token should validate: %v", err)
	}
	if claims.ExecutionID != "exec-1" {
		t.Fatalf("unexpected execution id: %s", claims.ExecutionID)
	}
}

// A job can legitimately run for hours, and its token has to stay good for the
// whole run. The ceiling used to be 2h, which cut the runtime API off mid-job.
func TestLongRunningJobTokenStaysValid(t *testing.T) {
	m := newManager()
	now := time.Now()
	issued := now.Add(-10 * time.Hour)
	if _, err := m.ValidateToken(sign(t, m, &Claims{
		JobID:            "job-1",
		RegisteredClaims: registered(issued, now.Add(15*time.Hour)),
	})); err != nil {
		t.Fatalf("a 25h job token still inside its expiry must validate: %v", err)
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	m := newManager()
	now := time.Now()
	if _, err := m.ValidateToken(sign(t, m, &Claims{
		JobID:            "job-1",
		RegisteredClaims: registered(now.Add(-2*time.Hour), now.Add(-time.Hour)),
	})); err == nil {
		t.Fatal("an expired token must be rejected")
	}
}

func TestAbsoluteLifetimeRejectsMisissuedToken(t *testing.T) {
	m := newManager()
	now := time.Now()
	// Issued beyond the ceiling but with a still-future expiry.
	if _, err := m.ValidateToken(sign(t, m, &Claims{
		JobID:            "job-1",
		RegisteredClaims: registered(now.Add(-absoluteMaxLifetime-time.Hour), now.Add(time.Hour)),
	})); err == nil {
		t.Fatal("a token past the absolute lifetime must be rejected")
	}
}

func TestTokenWithoutExpiryOrIssueTimeRejected(t *testing.T) {
	m := newManager()
	now := time.Now()
	for name, claims := range map[string]*Claims{
		"no exp": {JobID: "job-1", RegisteredClaims: jwt.RegisteredClaims{IssuedAt: jwt.NewNumericDate(now)}},
		"no iat": {JobID: "job-1", RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour))}},
	} {
		if _, err := m.ValidateToken(sign(t, m, claims)); err == nil {
			t.Fatalf("%s: must be rejected rather than panic or live forever", name)
		}
	}
}

func TestWrongSecretAndAlgorithmRejected(t *testing.T) {
	m := newManager()
	now := time.Now()
	other := NewJWTManager(config.AuthConfig{JWTSecret: "a-different-secret-at-least-32-characters"})
	if _, err := m.ValidateToken(sign(t, other, &Claims{
		RegisteredClaims: registered(now, now.Add(time.Hour)),
	})); err == nil {
		t.Fatal("a token signed with another secret must be rejected")
	}

	none, err := jwt.NewWithClaims(jwt.SigningMethodNone, &Claims{
		RegisteredClaims: registered(now, now.Add(time.Hour)),
	}).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.ValidateToken(none); err == nil {
		t.Fatal("an alg=none token must be rejected")
	}
}

// The orchestrator's container lineage historically minted the job id claim
// as `job_id` while this service reads `jobId`; the revocation middleware
// fails closed on an empty JobID, which silently 401'd every helper call
// from a container job (caught by the Phase 5 e2e pipeline test). Tokens
// from either lineage must yield a populated JobID.
func TestJobIDClaimAcceptsBothLineages(t *testing.T) {
	m := newManager()

	mint := func(claims *Claims) string {
		now := time.Now()
		claims.RegisteredClaims = jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		}
		tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).
			SignedString(m.secret)
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}

	// Current camelCase lineage (SSH + fixed container executor).
	got, err := m.ValidateToken(mint(&Claims{JobID: "job-camel", ExecutionID: "exec-1"}))
	if err != nil {
		t.Fatal(err)
	}
	if got.JobID != "job-camel" {
		t.Fatalf("jobId claim: got %q", got.JobID)
	}

	// Legacy snake_case lineage (older container-executor images).
	got, err = m.ValidateToken(mint(&Claims{LegacyJobID: "job-snake", ExecutionID: "exec-1"}))
	if err != nil {
		t.Fatal(err)
	}
	if got.JobID != "job-snake" {
		t.Fatalf("legacy job_id claim not honored: got %q", got.JobID)
	}
}

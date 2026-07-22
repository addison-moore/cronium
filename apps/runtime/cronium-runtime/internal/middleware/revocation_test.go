package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/addison-moore/cronium/apps/runtime/pkg/types"
	"github.com/sirupsen/logrus"
)

type fakeChecker struct {
	revoked bool
	err     error
}

func (f fakeChecker) IsJobRevoked(_ context.Context, _ string) (bool, error) {
	return f.revoked, f.err
}

func withClaims(r *http.Request, jobID string) *http.Request {
	claims := &types.TokenClaims{JobID: jobID, ExecutionID: "exec-1", UserID: "u1"}
	return r.WithContext(context.WithValue(r.Context(), tokenClaimsKey, claims))
}

func runRevocation(t *testing.T, checker RevocationChecker, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	log := logrus.New()
	log.SetOutput(httptest.NewRecorder().Body) // silence
	nextCalled := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusOK)
	})
	rr := httptest.NewRecorder()
	RevocationMiddleware(checker, log)(next).ServeHTTP(rr, req)
	if rr.Code == http.StatusOK && !nextCalled {
		t.Fatal("200 without calling next")
	}
	return rr
}

func TestRevocation_AllowsActiveJob(t *testing.T) {
	req := withClaims(httptest.NewRequest("GET", "/executions/exec-1/context", nil), "job-1")
	rr := runRevocation(t, fakeChecker{revoked: false}, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for an active job, got %d", rr.Code)
	}
}

func TestRevocation_RejectsRevokedJob(t *testing.T) {
	req := withClaims(httptest.NewRequest("GET", "/executions/exec-1/context", nil), "job-1")
	rr := runRevocation(t, fakeChecker{revoked: true}, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a revoked job, got %d", rr.Code)
	}
}

func TestRevocation_FailsClosedOnStoreError(t *testing.T) {
	req := withClaims(httptest.NewRequest("GET", "/executions/exec-1/context", nil), "job-1")
	rr := runRevocation(t, fakeChecker{err: errors.New("valkey down")}, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 (fail closed) on store error, got %d", rr.Code)
	}
}

func TestRevocation_RejectsMissingClaims(t *testing.T) {
	// No claims in context (AuthMiddleware would normally reject first, but the
	// revocation gate must also fail closed rather than allow).
	req := httptest.NewRequest("GET", "/executions/exec-1/context", nil)
	rr := runRevocation(t, fakeChecker{revoked: false}, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing claims, got %d", rr.Code)
	}
}

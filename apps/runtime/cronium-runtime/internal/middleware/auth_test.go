package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/runtime/internal/auth"
	"github.com/addison-moore/cronium/apps/runtime/internal/authctx"
	"github.com/addison-moore/cronium/apps/runtime/internal/config"
	"github.com/golang-jwt/jwt/v5"
	"github.com/sirupsen/logrus"
)

const testJWTSecret = "test-secret-at-least-32-characters-long!!"

func quietLog() *logrus.Logger {
	log := logrus.New()
	log.SetOutput(io.Discard)
	return log
}

func signedToken(t *testing.T, secret string, exp time.Time) string {
	t.Helper()
	now := time.Now()
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, &auth.Claims{
		JobID:       "job-1",
		ExecutionID: "exec-1",
		UserID:      "user-1",
		Capability:  "cap-token",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now.Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func TestAuthMiddleware(t *testing.T) {
	manager := auth.NewJWTManager(config.AuthConfig{JWTSecret: testJWTSecret})
	future := time.Now().Add(time.Hour)

	tests := []struct {
		name       string
		header     string
		wantStatus int
	}{
		{"no header", "", http.StatusUnauthorized},
		{"not a bearer token", "Basic abc", http.StatusUnauthorized},
		{"too many parts", "Bearer a b", http.StatusUnauthorized},
		{"garbage token", "Bearer not-a-jwt", http.StatusUnauthorized},
		{"wrong secret", "Bearer " + signedToken(t, "another-secret-at-least-32-characters!!", future), http.StatusUnauthorized},
		{"expired", "Bearer " + signedToken(t, testJWTSecret, time.Now().Add(-time.Minute)), http.StatusUnauthorized},
		{"valid", "Bearer " + signedToken(t, testJWTSecret, future), http.StatusOK},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var reached bool
			var claimsExecutionID, capability string
			handler := AuthMiddleware(manager, quietLog())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reached = true
				if claims, ok := GetTokenClaims(r.Context()); ok {
					claimsExecutionID = claims.ExecutionID
				}
				capability = authctx.CapabilityFromContext(r.Context())
			}))

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if wantReached := tc.wantStatus == http.StatusOK; reached != wantReached {
				t.Fatalf("handler reached = %v, want %v", reached, wantReached)
			}
			if reached {
				if claimsExecutionID != "exec-1" {
					t.Fatalf("claims not in context, execution id = %q", claimsExecutionID)
				}
				if capability != "cap-token" {
					t.Fatalf("capability not carried for outbound calls, got %q", capability)
				}
			}
		})
	}
}

func TestRateLimitMiddleware(t *testing.T) {
	limiter := NewRateLimiter(2, quietLog())
	handler := RateLimitMiddleware(limiter)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	withExecution := func(id string) *http.Request {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		manager := auth.NewJWTManager(config.AuthConfig{JWTSecret: testJWTSecret})
		tok := signedTokenFor(t, id)
		var out *http.Request
		AuthMiddleware(manager, quietLog())(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			out = r
		})).ServeHTTP(httptest.NewRecorder(), withBearer(req, tok))
		if out == nil {
			t.Fatal("token was not accepted")
		}
		return out
	}
	serve := func(req *http.Request) int {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}

	for i := 0; i < 2; i++ {
		if code := serve(withExecution("exec-a")); code != http.StatusOK {
			t.Fatalf("request %d within the burst got %d", i, code)
		}
	}
	if code := serve(withExecution("exec-a")); code != http.StatusTooManyRequests {
		t.Fatalf("over the limit got %d, want 429", code)
	}
	// Limits are per execution: one noisy job must not starve the rest.
	if code := serve(withExecution("exec-b")); code != http.StatusOK {
		t.Fatalf("another execution got %d", code)
	}
}

func signedTokenFor(t *testing.T, executionID string) string {
	t.Helper()
	now := time.Now()
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, &auth.Claims{
		JobID:       "job-1",
		ExecutionID: executionID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}).SignedString([]byte(testJWTSecret))
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func withBearer(req *http.Request, token string) *http.Request {
	req.Header.Set("Authorization", "Bearer "+token)
	return req
}

func TestLoggingMiddlewarePassesThroughStatusAndBody(t *testing.T) {
	handler := LoggingMiddleware(quietLog())(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("short and stout"))
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusTeapot {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec.Body.String() != "short and stout" {
		t.Fatalf("body = %q", rec.Body.String())
	}
}

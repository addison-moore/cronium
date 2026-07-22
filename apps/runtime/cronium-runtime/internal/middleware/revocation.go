package middleware

import (
	"context"
	"net/http"

	"github.com/sirupsen/logrus"
)

// RevocationChecker reports whether a job's execution tokens have been revoked.
// *service.RuntimeService satisfies it.
type RevocationChecker interface {
	IsJobRevoked(ctx context.Context, jobID string) (bool, error)
}

// RevocationMiddleware rejects requests whose job has been revoked (HI-14).
// Runs AFTER AuthMiddleware so the validated claims (and jobId) are in context.
//
// Fails CLOSED: if the revocation store cannot be reached, the request is
// rejected rather than allowed — a revoked token must never slip through during
// a store outage. The runtime already requires Valkey to function, so this does
// not add a new hard dependency.
func RevocationMiddleware(checker RevocationChecker, log *logrus.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := GetTokenClaims(r.Context())
			if !ok || claims.JobID == "" {
				// AuthMiddleware should have populated claims; missing jobId
				// means we cannot evaluate revocation — fail closed.
				writeError(w, http.StatusUnauthorized, "missing token claims")
				return
			}

			revoked, err := checker.IsJobRevoked(r.Context(), claims.JobID)
			if err != nil {
				log.WithError(err).WithField("jobID", claims.JobID).
					Warn("Revocation check failed; rejecting request (fail closed)")
				writeError(w, http.StatusServiceUnavailable, "revocation check unavailable")
				return
			}
			if revoked {
				log.WithField("jobID", claims.JobID).
					Info("Rejecting request: execution token revoked (job is terminal)")
				writeError(w, http.StatusForbidden, "execution token revoked")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

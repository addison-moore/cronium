package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/addison-moore/cronium/apps/runtime/internal/auth"
	"github.com/addison-moore/cronium/apps/runtime/pkg/types"
	"github.com/sirupsen/logrus"
)

type contextKey string

const (
	tokenClaimsKey contextKey = "tokenClaims"
)

// AuthMiddleware handles JWT authentication
func AuthMiddleware(jwtManager *auth.JWTManager, log *logrus.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract token from Authorization header
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				writeError(w, http.StatusUnauthorized, "missing authorization header")
				return
			}

			// Check Bearer prefix
			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || parts[0] != "Bearer" {
				writeError(w, http.StatusUnauthorized, "invalid authorization header format")
				return
			}

			token := parts[1]

			// Validate token
			claims, err := jwtManager.ValidateToken(token)
			if err != nil {
				log.WithError(err).Debug("Token validation failed")
				writeError(w, http.StatusUnauthorized, "invalid or expired token")
				return
			}

			log.WithFields(logrus.Fields{
				"executionID": claims.ExecutionID,
				"jobID": claims.JobID,
				"userID": claims.UserID,
				"eventID": claims.EventID,
				"path": r.URL.Path,
			}).Debug("JWT token validated successfully")

			// Add claims to context
			ctx := context.WithValue(r.Context(), tokenClaimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetTokenClaims retrieves token claims from context
func GetTokenClaims(ctx context.Context) (*types.TokenClaims, bool) {
	claims, ok := ctx.Value(tokenClaimsKey).(*types.TokenClaims)
	return claims, ok
}

// writeError writes an error response
func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write([]byte(`{"error":"` + message + `"}`))
}
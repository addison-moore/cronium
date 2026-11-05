package auth

import (
	"fmt"
	"time"

	"github.com/addison-moore/cronium/apps/runtime/internal/config"
	"github.com/addison-moore/cronium/apps/runtime/pkg/types"
	"github.com/golang-jwt/jwt/v5"
)

// absoluteMaxLifetime is the ceiling on any token's life (HI-14). The real bound is
// the job: the orchestrator mints each token for the job's own timeout plus a small
// buffer, and revokes it the moment the job ends. This only catches a mis-issued
// token, so it sits above any execution timeout a deployment would configure. It was
// 2h, which cut the runtime API off from every longer job mid-run.
const absoluteMaxLifetime = 7 * 24 * time.Hour

// JWTManager handles JWT token operations
type JWTManager struct {
	secret []byte
}

// Claims represents the JWT claims
type Claims struct {
	JobID string `json:"jobId"` // From orchestrator
	// LegacyJobID tolerates tokens minted by orchestrator images from before
	// the container lineage was aligned to `jobId` (it used `job_id`). The
	// runtime and orchestrator ship as separate images, so version skew is
	// real; without this fallback the revocation middleware fails closed
	// (401 "missing token claims") for every helper call from such a job.
	LegacyJobID string `json:"job_id,omitempty"`
	ExecutionID string `json:"executionId"`
	UserID      string `json:"userId"`
	EventID     string `json:"eventId"`
	// Capability is the app-minted per-job capability token (HI-10), embedded
	// by the orchestrator so the runtime can present it on its outbound calls
	// to the app's job-scoped internal routes. Opaque to the runtime.
	Capability string `json:"capabilityToken,omitempty"`
	jwt.RegisteredClaims
}

// NewJWTManager creates a new JWT manager
func NewJWTManager(cfg config.AuthConfig) *JWTManager {
	return &JWTManager{secret: []byte(cfg.JWTSecret)}
}

// ValidateToken validates a JWT token and returns the claims
func (m *JWTManager) ValidateToken(tokenString string) (*types.TokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// Verify signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return m.secret, nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(*Claims)
	if !ok {
		return nil, fmt.Errorf("invalid token claims")
	}

	// The library accepts a token with no exp unless told otherwise, and a token
	// that never expires is exactly what this check exists to refuse.
	if claims.ExpiresAt == nil || claims.IssuedAt == nil {
		return nil, fmt.Errorf("token missing expiry or issue time")
	}

	// Enforce the absolute ceiling independently of ExpiresAt (HI-14): a mis-issued
	// token with a distant expiry still dies here.
	if time.Now().After(claims.IssuedAt.Add(absoluteMaxLifetime)) {
		return nil, fmt.Errorf("token exceeded absolute lifetime")
	}

	jobID := claims.JobID
	if jobID == "" {
		jobID = claims.LegacyJobID
	}

	return &types.TokenClaims{
		JobID:       jobID,
		ExecutionID: claims.ExecutionID,
		UserID:      claims.UserID,
		EventID:     claims.EventID,
		Capability:  claims.Capability,
		ExpiresAt:   claims.ExpiresAt.Time,
		IssuedAt:    claims.IssuedAt.Time,
	}, nil
}

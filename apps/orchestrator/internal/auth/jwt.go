package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWTManager handles JWT token generation for runtime helpers
type JWTManager struct {
	secret []byte
}

// Claims represents the JWT claims for runtime helpers
type Claims struct {
	JobID       string `json:"jobId"`
	ExecutionID string `json:"executionId"`
	UserID      string `json:"userId"`
	EventID     string `json:"eventId"`
	// Capability is the app-minted per-job capability token (HI-10), carried to
	// the remote runner/runtime so it can present it on outbound job-scoped
	// calls to the app.
	Capability string `json:"capabilityToken,omitempty"`
	jwt.RegisteredClaims
}

// NewJWTManager creates a new JWT manager
func NewJWTManager(secret string) *JWTManager {
	return &JWTManager{
		secret: []byte(secret),
	}
}

// GenerateJobToken generates a JWT token for a job execution
func (m *JWTManager) GenerateJobToken(jobID, executionID, userID, eventID, capability string) (string, error) {
	now := time.Now()
	// Token valid for 1 hour (should be enough for most script executions)
	expiresAt := now.Add(1 * time.Hour)

	claims := &Claims{
		JobID:       jobID,
		ExecutionID: executionID,
		UserID:      userID,
		EventID:     eventID,
		Capability:  capability,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "cronium-orchestrator",
			Subject:   jobID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	tokenString, err := token.SignedString(m.secret)
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, nil
}

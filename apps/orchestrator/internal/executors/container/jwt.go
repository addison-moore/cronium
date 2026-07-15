package container

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ExecutionClaims represents the JWT claims for execution tokens
type ExecutionClaims struct {
	ExecutionID string `json:"executionId"` // Changed to camelCase to match runtime API
	UserID      string `json:"userId"`      // Added for runtime API compatibility
	EventID     string `json:"eventId"`     // Added for runtime API compatibility
	JobID       string `json:"job_id"`      // Keep for backward compatibility
	Scope       string `json:"scope"`
	jwt.RegisteredClaims
}

// generateJWT generates a JWT token for the execution. executionID must be the
// same id exported to the container as CRONIUM_EXECUTION_ID and used in the
// runtime API URL, or the runtime handler rejects calls with "execution ID
// mismatch" (403).
func generateJWT(executionID string, jobID string, secret string, userID string, eventID string, lifetime time.Duration) (string, error) {
	if secret == "" {
		return "", fmt.Errorf("JWT secret not configured")
	}

	// The token must outlive the job, or a long-running script's late
	// cronium.output()/input() call gets a 401 mid-execution.
	if lifetime < 2*time.Hour {
		lifetime = 2 * time.Hour
	}

	// Create claims
	claims := ExecutionClaims{
		ExecutionID: executionID,
		UserID:      userID,
		EventID:     eventID,
		JobID:       jobID,
		Scope:       "execution",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   fmt.Sprintf("job:%s", jobID),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(lifetime)),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "cronium-orchestrator",
		},
	}

	// Create token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	// Sign and return
	tokenString, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, nil
}

// validateJWT validates a JWT token
func validateJWT(tokenString string, secret string) (*ExecutionClaims, error) {
	// Parse token
	token, err := jwt.ParseWithClaims(tokenString, &ExecutionClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	// Extract claims
	if claims, ok := token.Claims.(*ExecutionClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token claims")
}

package auth

import (
	"fmt"
	"time"

	"github.com/addison-moore/cronium/apps/runtime/internal/config"
	"github.com/addison-moore/cronium/apps/runtime/pkg/types"
	"github.com/golang-jwt/jwt/v5"
)

// absoluteMaxLifetime bounds a runtime token's total life across refreshes
// (HI-14). No token — original or refreshed — is valid beyond its original
// issuance plus this cap, so a leaked token cannot be extended indefinitely.
const absoluteMaxLifetime = 2 * time.Hour

// JWTManager handles JWT token operations
type JWTManager struct {
	secret          []byte
	tokenExpiration time.Duration
}

// Claims represents the JWT claims
type Claims struct {
	JobID       string `json:"jobId"` // From orchestrator
	ExecutionID string `json:"executionId"`
	UserID      string `json:"userId"`
	EventID     string `json:"eventId"`
	// OrigIat is the immutable original issuance time; preserved across
	// refreshes so the absolute lifetime cap cannot be reset.
	OrigIat *jwt.NumericDate `json:"origIat,omitempty"`
	jwt.RegisteredClaims
}

// NewJWTManager creates a new JWT manager
func NewJWTManager(cfg config.AuthConfig) *JWTManager {
	exp := cfg.TokenExpiration
	if exp <= 0 || exp > absoluteMaxLifetime {
		exp = absoluteMaxLifetime
	}
	return &JWTManager{
		secret:          []byte(cfg.JWTSecret),
		tokenExpiration: exp,
	}
}

// GenerateToken generates a new JWT token for an execution
func (m *JWTManager) GenerateToken(executionID, userID, eventID string) (string, error) {
	now := time.Now()
	return m.generate(executionID, userID, eventID, now, now)
}

// generate mints a token, preserving origIat and capping the expiry at the
// absolute lifetime bound.
func (m *JWTManager) generate(executionID, userID, eventID string, now, origIat time.Time) (string, error) {
	expiresAt := now.Add(m.tokenExpiration)
	if cap := origIat.Add(absoluteMaxLifetime); expiresAt.After(cap) {
		expiresAt = cap
	}

	claims := &Claims{
		ExecutionID: executionID,
		UserID:      userID,
		EventID:     eventID,
		OrigIat:     jwt.NewNumericDate(origIat),
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "cronium-runtime",
			Subject:   executionID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	tokenString, err := token.SignedString(m.secret)
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, nil
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

	now := time.Now()

	// Check expiration
	if claims.ExpiresAt != nil && claims.ExpiresAt.Before(now) {
		return nil, fmt.Errorf("token expired")
	}

	// Enforce the absolute lifetime cap independently of ExpiresAt (HI-14): a
	// token is invalid once it is older than absoluteMaxLifetime from its
	// original issuance, even if a (mis-issued) ExpiresAt is later. Fall back to
	// IssuedAt for tokens minted before OrigIat existed.
	origIat := claims.IssuedAt
	if claims.OrigIat != nil {
		origIat = claims.OrigIat
	}
	if origIat != nil && now.After(origIat.Time.Add(absoluteMaxLifetime)) {
		return nil, fmt.Errorf("token exceeded absolute lifetime")
	}

	return &types.TokenClaims{
		JobID:       claims.JobID,
		ExecutionID: claims.ExecutionID,
		UserID:      claims.UserID,
		EventID:     claims.EventID,
		ExpiresAt:   claims.ExpiresAt.Time,
		IssuedAt:    claims.IssuedAt.Time,
	}, nil
}

// RefreshToken issues a new token that preserves the original issuance time, so
// the absolute lifetime cap is not reset. Refresh past the cap is refused.
func (m *JWTManager) RefreshToken(oldToken string) (string, error) {
	token, err := jwt.ParseWithClaims(oldToken, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return m.secret, nil
	})
	if err != nil || !token.Valid {
		return "", fmt.Errorf("invalid token for refresh")
	}
	claims, ok := token.Claims.(*Claims)
	if !ok {
		return "", fmt.Errorf("invalid token claims")
	}

	now := time.Now()
	if claims.ExpiresAt != nil && claims.ExpiresAt.Before(now) {
		return "", fmt.Errorf("token expired")
	}
	origIat := claims.IssuedAt
	if claims.OrigIat != nil {
		origIat = claims.OrigIat
	}
	if origIat == nil {
		return "", fmt.Errorf("token missing issuance time")
	}
	if now.After(origIat.Time.Add(absoluteMaxLifetime)) {
		return "", fmt.Errorf("token exceeded absolute lifetime; cannot refresh")
	}

	return m.generate(claims.ExecutionID, claims.UserID, claims.EventID, now, origIat.Time)
}

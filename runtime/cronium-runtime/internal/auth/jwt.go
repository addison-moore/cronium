package auth

import (
	"fmt"
	"time"

	"github.com/addison-more/cronium/runtime/internal/config"
	"github.com/addison-more/cronium/runtime/pkg/types"
	"github.com/golang-jwt/jwt/v5"
)

// JWTManager handles JWT token operations
type JWTManager struct {
	secret          []byte
	tokenExpiration time.Duration
}

// Claims represents the JWT claims
type Claims struct {
	ExecutionID string `json:"executionId"`
	UserID      string `json:"userId"`
	EventID     string `json:"eventId"`
	jwt.RegisteredClaims
}

// NewJWTManager creates a new JWT manager
func NewJWTManager(cfg config.AuthConfig) *JWTManager {
	return &JWTManager{
		secret:          []byte(cfg.JWTSecret),
		tokenExpiration: cfg.TokenExpiration,
	}
}

// GenerateToken generates a new JWT token for an execution
func (m *JWTManager) GenerateToken(executionID, userID, eventID string) (string, error) {
	now := time.Now()
	expiresAt := now.Add(m.tokenExpiration)

	claims := &Claims{
		ExecutionID: executionID,
		UserID:      userID,
		EventID:     eventID,
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

	// Check expiration
	if claims.ExpiresAt != nil && claims.ExpiresAt.Before(time.Now()) {
		return nil, fmt.Errorf("token expired")
	}

	return &types.TokenClaims{
		ExecutionID: claims.ExecutionID,
		UserID:      claims.UserID,
		EventID:     claims.EventID,
		ExpiresAt:   claims.ExpiresAt.Time,
		IssuedAt:    claims.IssuedAt.Time,
	}, nil
}

// RefreshToken generates a new token with extended expiration
func (m *JWTManager) RefreshToken(oldToken string) (string, error) {
	claims, err := m.ValidateToken(oldToken)
	if err != nil {
		return "", fmt.Errorf("invalid token for refresh: %w", err)
	}

	// Generate new token with same claims but new expiration
	return m.GenerateToken(claims.ExecutionID, claims.UserID, claims.EventID)
}
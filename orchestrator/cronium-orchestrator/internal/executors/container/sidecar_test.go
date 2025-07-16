package container

import (
	"testing"
	"time"

	"github.com/sirupsen/logrus"
)

func TestJWTGeneration(t *testing.T) {
	tests := []struct {
		name      string
		jobID     string
		secret    string
		wantError bool
	}{
		{
			name:      "valid token generation",
			jobID:     "test-job-123",
			secret:    "test-secret-key",
			wantError: false,
		},
		{
			name:      "empty secret",
			jobID:     "test-job-123",
			secret:    "",
			wantError: true,
		},
		{
			name:      "empty job ID",
			jobID:     "",
			secret:    "test-secret-key",
			wantError: false, // Should still generate, just with empty ID
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, err := generateJWT(tt.jobID, tt.secret)
			
			if tt.wantError {
				if err == nil {
					t.Errorf("expected error but got none")
				}
				return
			}
			
			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			
			if token == "" {
				t.Errorf("expected non-empty token")
				return
			}
			
			// Validate the token
			claims, err := validateJWT(token, tt.secret)
			if err != nil {
				t.Errorf("failed to validate generated token: %v", err)
				return
			}
			
			if claims.JobID != tt.jobID {
				t.Errorf("expected job ID %s, got %s", tt.jobID, claims.JobID)
			}
			
			if claims.Scope != "execution" {
				t.Errorf("expected scope 'execution', got %s", claims.Scope)
			}
		})
	}
}

func TestJWTValidation(t *testing.T) {
	secret := "test-secret-key"
	jobID := "test-job-123"
	
	// Generate a valid token
	validToken, err := generateJWT(jobID, secret)
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}
	
	tests := []struct {
		name      string
		token     string
		secret    string
		wantError bool
	}{
		{
			name:      "valid token",
			token:     validToken,
			secret:    secret,
			wantError: false,
		},
		{
			name:      "wrong secret",
			token:     validToken,
			secret:    "wrong-secret",
			wantError: true,
		},
		{
			name:      "invalid token",
			token:     "invalid.token.here",
			secret:    secret,
			wantError: true,
		},
		{
			name:      "empty token",
			token:     "",
			secret:    secret,
			wantError: true,
		},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			claims, err := validateJWT(tt.token, tt.secret)
			
			if tt.wantError {
				if err == nil {
					t.Errorf("expected error but got none")
				}
				return
			}
			
			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			
			if claims.JobID != jobID {
				t.Errorf("expected job ID %s, got %s", jobID, claims.JobID)
			}
		})
	}
}

func TestTokenExpiry(t *testing.T) {
	secret := "test-secret-key"
	jobID := "test-job-123"
	
	// Generate token
	token, err := generateJWT(jobID, secret)
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}
	
	// Validate immediately - should work
	claims, err := validateJWT(token, secret)
	if err != nil {
		t.Fatalf("failed to validate token: %v", err)
	}
	
	// Check expiry is set correctly (2 hours)
	expiry := claims.ExpiresAt.Time
	expectedExpiry := time.Now().Add(2 * time.Hour)
	
	// Allow 1 minute tolerance
	if expiry.Before(expectedExpiry.Add(-1*time.Minute)) || expiry.After(expectedExpiry.Add(1*time.Minute)) {
		t.Errorf("unexpected expiry time: got %v, expected around %v", expiry, expectedExpiry)
	}
}

// Integration test for sidecar manager (requires Docker)
func TestSidecarManagerIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	
	// This would require a full Docker setup
	// For now, we'll just test the token management functions
	
	executor := &Executor{
		tokens: make(map[string]string),
		log:    logrus.New(),
	}
	
	sm := NewSidecarManager(executor, executor.log)
	
	// Test token generation and storage
	jobID := "test-job-123"
	executor.config.Runtime.JWTSecret = "test-secret"
	
	token, err := sm.generateExecutionToken(jobID)
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}
	
	// Store token
	sm.storeExecutionToken(jobID, token)
	
	// Retrieve token
	retrievedToken, err := sm.getExecutionToken(jobID)
	if err != nil {
		t.Fatalf("failed to retrieve token: %v", err)
	}
	
	if retrievedToken != token {
		t.Errorf("expected token %s, got %s", token, retrievedToken)
	}
	
	// Test missing token
	_, err = sm.getExecutionToken("non-existent-job")
	if err == nil {
		t.Errorf("expected error for non-existent job")
	}
}
package auth

import (
	"testing"
	"time"

	"github.com/addison-moore/cronium/apps/runtime/internal/config"
)

func newManager() *JWTManager {
	return NewJWTManager(config.AuthConfig{
		JWTSecret:       "test-secret-at-least-32-characters-long!!",
		TokenExpiration: time.Hour,
	})
}

func TestValidateFreshToken(t *testing.T) {
	m := newManager()
	tok, err := m.GenerateToken("exec-1", "user-1", "event-1")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := m.ValidateToken(tok)
	if err != nil {
		t.Fatalf("fresh token should validate: %v", err)
	}
	if claims.ExecutionID != "exec-1" {
		t.Fatalf("unexpected execution id: %s", claims.ExecutionID)
	}
}

func TestTokenExpirationCappedAtAbsoluteMax(t *testing.T) {
	// Even if config asks for more than the absolute max, the manager clamps it.
	m := NewJWTManager(config.AuthConfig{
		JWTSecret:       "test-secret-at-least-32-characters-long!!",
		TokenExpiration: 24 * time.Hour,
	})
	if m.tokenExpiration != absoluteMaxLifetime {
		t.Fatalf("expected clamp to %v, got %v", absoluteMaxLifetime, m.tokenExpiration)
	}
}

func TestAbsoluteLifetimeRejectsOldToken(t *testing.T) {
	m := newManager()
	// Mint a token whose original issuance is 3h in the past (beyond the 2h cap),
	// with a still-future ExpiresAt via the current-now.
	past := time.Now().Add(-3 * time.Hour)
	tok, err := m.generate("exec-1", "user-1", "event-1", time.Now(), past)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.ValidateToken(tok); err == nil {
		t.Fatal("token past the absolute lifetime must be rejected")
	}
}

func TestRefreshPreservesOriginalLifetimeAndRefusesPastCap(t *testing.T) {
	m := newManager()

	// A fresh token refreshes fine and stays within the cap.
	fresh, _ := m.GenerateToken("exec-1", "user-1", "event-1")
	refreshed, err := m.RefreshToken(fresh)
	if err != nil {
		t.Fatalf("fresh token should refresh: %v", err)
	}
	if _, err := m.ValidateToken(refreshed); err != nil {
		t.Fatalf("refreshed token should validate: %v", err)
	}

	// A token whose original issuance is beyond the cap cannot be refreshed,
	// even though its ExpiresAt is still in the future.
	past := time.Now().Add(-(absoluteMaxLifetime + time.Minute))
	old, _ := m.generate("exec-1", "user-1", "event-1", time.Now(), past)
	if _, err := m.RefreshToken(old); err == nil {
		t.Fatal("refresh past the absolute lifetime must be refused")
	}
}

func TestRefreshedTokenCannotExceedOriginalCap(t *testing.T) {
	m := newManager()
	// Original issuance 90 minutes ago; a refresh now should cap the new expiry
	// at origIat + 2h ≈ 30 minutes from now, not now + 1h.
	orig := time.Now().Add(-90 * time.Minute)
	tok, _ := m.generate("exec-1", "user-1", "event-1", time.Now(), orig)
	refreshed, err := m.RefreshToken(tok)
	if err != nil {
		t.Fatalf("should refresh within cap: %v", err)
	}
	claims, err := m.ValidateToken(refreshed)
	if err != nil {
		t.Fatal(err)
	}
	// Expiry must not exceed orig + absoluteMaxLifetime (+ small skew).
	if claims.ExpiresAt.After(orig.Add(absoluteMaxLifetime).Add(time.Second)) {
		t.Fatalf("refreshed expiry %v exceeds the absolute cap", claims.ExpiresAt)
	}
}

package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"golang.org/x/time/rate"
)

// RateLimiter holds rate limiters for each IP
type RateLimiter struct {
	limiters map[string]*rate.Limiter
	mu       sync.RWMutex
	limit    rate.Limit
	burst    int
	log      *logrus.Logger
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(perMinute int, log *logrus.Logger) *RateLimiter {
	return &RateLimiter{
		limiters: make(map[string]*rate.Limiter),
		limit:    rate.Limit(float64(perMinute) / 60.0),
		burst:    perMinute,
		log:      log,
	}
}

// getLimiter returns the rate limiter for the given key
func (rl *RateLimiter) getLimiter(key string) *rate.Limiter {
	rl.mu.RLock()
	limiter, exists := rl.limiters[key]
	rl.mu.RUnlock()

	if !exists {
		limiter = rate.NewLimiter(rl.limit, rl.burst)
		rl.mu.Lock()
		rl.limiters[key] = limiter
		rl.mu.Unlock()
	}

	return limiter
}

// cleanup removes old limiters
func (rl *RateLimiter) cleanup() {
	for {
		time.Sleep(10 * time.Minute)
		
		rl.mu.Lock()
		// Simple cleanup - in production, track last used time
		if len(rl.limiters) > 10000 {
			rl.limiters = make(map[string]*rate.Limiter)
		}
		rl.mu.Unlock()
	}
}

// RateLimitMiddleware implements rate limiting per execution
func RateLimitMiddleware(limiter *RateLimiter) func(http.Handler) http.Handler {
	// Start cleanup goroutine
	go limiter.cleanup()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Get execution ID from token claims
			claims, ok := GetTokenClaims(r.Context())
			if !ok {
				// If no claims, use IP address
				key := r.RemoteAddr
				rl := limiter.getLimiter(key)
				
				if !rl.Allow() {
					limiter.log.WithField("ip", key).Warn("Rate limit exceeded")
					writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
					return
				}
			} else {
				// Use execution ID for rate limiting
				key := claims.ExecutionID
				rl := limiter.getLimiter(key)
				
				if !rl.Allow() {
					limiter.log.WithField("executionId", key).Warn("Rate limit exceeded")
					writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
					return
				}
			}

			next.ServeHTTP(w, r)
		})
	}
}
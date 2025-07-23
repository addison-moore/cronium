package middleware

import (
	"net/http"
	"time"

	"github.com/sirupsen/logrus"
)

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	status int
	size   int
}

func (rw *responseWriter) WriteHeader(status int) {
	rw.status = status
	rw.ResponseWriter.WriteHeader(status)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	size, err := rw.ResponseWriter.Write(b)
	rw.size += size
	return size, err
}

// LoggingMiddleware logs HTTP requests
func LoggingMiddleware(log *logrus.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Wrap response writer
			wrapped := &responseWriter{
				ResponseWriter: w,
				status:         http.StatusOK,
			}

			// Process request
			next.ServeHTTP(wrapped, r)

			// Log request
			duration := time.Since(start)
			log.WithFields(logrus.Fields{
				"method":     r.Method,
				"path":       r.URL.Path,
				"status":     wrapped.status,
				"size":       wrapped.size,
				"duration":   duration.Milliseconds(),
				"ip":         r.RemoteAddr,
				"user_agent": r.UserAgent(),
			}).Info("HTTP request")
		})
	}
}
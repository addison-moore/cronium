package api

import (
	"context"
	"net/http"
	"time"

	"github.com/addison-moore/cronium/apps/runtime/internal/auth"
	"github.com/addison-moore/cronium/apps/runtime/internal/config"
	"github.com/addison-moore/cronium/apps/runtime/internal/handlers"
	"github.com/addison-moore/cronium/apps/runtime/internal/middleware"
	"github.com/addison-moore/cronium/apps/runtime/internal/service"
	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/sirupsen/logrus"
)

// NewRouter creates a new HTTP router
func NewRouter(runtime *service.RuntimeService, cfg *config.Config, log *logrus.Logger) http.Handler {
	r := chi.NewRouter()

	// Basic middleware
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(chimiddleware.Recoverer)
	r.Use(middleware.LoggingMiddleware(log))

	// Add request time to context
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), "requestTime", time.Now())
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})

	// CORS configuration
	if cfg.Security.EnableCORS {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   cfg.Security.AllowedOrigins,
			AllowedMethods:   cfg.Security.AllowedMethods,
			AllowedHeaders:   cfg.Security.AllowedHeaders,
			ExposedHeaders:   []string{"Link"},
			AllowCredentials: true,
			MaxAge:           300,
		}))
	}

	// Create handlers
	h := handlers.NewHandler(runtime, log)

	// Public routes
	r.Group(func(r chi.Router) {
		r.Get("/health", h.Health)
		r.Handle("/metrics", promhttp.Handler())
	})

	// Protected routes
	r.Group(func(r chi.Router) {
		// JWT authentication
		jwtManager := auth.NewJWTManager(cfg.Auth)
		r.Use(middleware.AuthMiddleware(jwtManager, log))

		// Rate limiting
		rateLimiter := middleware.NewRateLimiter(cfg.Security.RateLimitPerMin, log)
		r.Use(middleware.RateLimitMiddleware(rateLimiter))

		// Execution endpoints
		r.Route("/executions/{id}", func(r chi.Router) {
			r.Get("/input", h.GetInput)
			r.Post("/output", h.SetOutput)
			r.Get("/context", h.GetContext)
			r.Post("/condition", h.SetCondition)
			
			// Variables
			r.Route("/variables", func(r chi.Router) {
				r.Get("/{key}", h.GetVariable)
				r.Put("/{key}", h.SetVariable)
			})
		})

		// Tool actions
		r.Post("/tool-actions/execute", h.ExecuteToolAction)
	})

	return r
}
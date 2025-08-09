package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Mock storage
var (
	mu        sync.RWMutex
	variables = make(map[string]interface{})
	outputs   = make(map[string]interface{})
	contexts  = map[string]interface{}{
		"test-exec-123": map[string]interface{}{
			"executionId": "test-exec-123",
			"eventId":     "test-event-789",
			"eventName":   "Test Event",
			"eventType":   "manual",
			"userId":      "test-user-456",
			"startTime":   time.Now().Format(time.RFC3339),
			"metadata": map[string]interface{}{
				"test": true,
			},
		},
	}
)

func main() {
	r := chi.NewRouter()
	
	// Middleware
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	
	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "healthy",
			"time":   time.Now().Format(time.RFC3339),
		})
	})
	
	// Mock JWT validation middleware
	authMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			if auth == "" {
				http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
				return
			}
			// For testing, accept any token
			log.Printf("Auth token: %s", auth)
			next.ServeHTTP(w, r)
		})
	}
	
	// Protected routes
	r.Group(func(r chi.Router) {
		r.Use(authMiddleware)
		
		// Execution endpoints
		r.Route("/executions/{id}", func(r chi.Router) {
			// Get input
			r.Get("/input", func(w http.ResponseWriter, r *http.Request) {
				execID := chi.URLParam(r, "id")
				log.Printf("GET /executions/%s/input", execID)
				
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success": true,
					"data": map[string]interface{}{
						"message": "Test input from mock API",
						"timestamp": time.Now().Format(time.RFC3339),
					},
				})
			})
			
			// Set output
			r.Post("/output", func(w http.ResponseWriter, r *http.Request) {
				execID := chi.URLParam(r, "id")
				var body map[string]interface{}
				json.NewDecoder(r.Body).Decode(&body)
				
				log.Printf("POST /executions/%s/output: %v", execID, body)
				
				mu.Lock()
				outputs[execID] = body["data"]
				mu.Unlock()
				
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success": true,
				})
			})
			
			// Get context
			r.Get("/context", func(w http.ResponseWriter, r *http.Request) {
				execID := chi.URLParam(r, "id")
				log.Printf("GET /executions/%s/context", execID)
				
				mu.RLock()
				ctx, exists := contexts[execID]
				mu.RUnlock()
				
				if !exists {
					// Create mock context
					ctx = map[string]interface{}{
						"executionId": execID,
						"eventId":     "mock-event-" + execID,
						"eventName":   "Mock Event",
						"eventType":   "manual",
						"userId":      "mock-user",
						"startTime":   time.Now().Format(time.RFC3339),
						"metadata":    map[string]interface{}{},
					}
				}
				
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success": true,
					"data":    ctx,
				})
			})
			
			// Variables
			r.Route("/variables", func(r chi.Router) {
				// Get variable
				r.Get("/{key}", func(w http.ResponseWriter, r *http.Request) {
					execID := chi.URLParam(r, "id")
					key := chi.URLParam(r, "key")
					varKey := fmt.Sprintf("%s:%s", execID, key)
					
					log.Printf("GET /executions/%s/variables/%s", execID, key)
					
					mu.RLock()
					value, exists := variables[varKey]
					mu.RUnlock()
					
					if !exists {
						value = nil
					}
					
					json.NewEncoder(w).Encode(map[string]interface{}{
						"success": true,
						"data": map[string]interface{}{
							"key":   key,
							"value": value,
						},
					})
				})
				
				// Set variable
				r.Put("/{key}", func(w http.ResponseWriter, r *http.Request) {
					execID := chi.URLParam(r, "id")
					key := chi.URLParam(r, "key")
					varKey := fmt.Sprintf("%s:%s", execID, key)
					
					var body map[string]interface{}
					json.NewDecoder(r.Body).Decode(&body)
					
					log.Printf("PUT /executions/%s/variables/%s: %v", execID, key, body)
					
					mu.Lock()
					variables[varKey] = body["value"]
					mu.Unlock()
					
					json.NewEncoder(w).Encode(map[string]interface{}{
						"success": true,
					})
				})
			})
		})
	})
	
	// Summary endpoint for testing
	r.Get("/summary", func(w http.ResponseWriter, r *http.Request) {
		mu.RLock()
		defer mu.RUnlock()
		
		json.NewEncoder(w).Encode(map[string]interface{}{
			"outputs":   outputs,
			"variables": variables,
			"contexts":  contexts,
		})
	})
	
	port := ":8089"
	log.Printf("Starting mock runtime API on %s", port)
	log.Printf("View stored data at: http://localhost%s/summary", port)
	
	if err := http.ListenAndServe(port, r); err != nil {
		log.Fatal(err)
	}
}
package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/addison-more/cronium/runtime/internal/middleware"
	"github.com/addison-more/cronium/runtime/internal/service"
	"github.com/addison-more/cronium/runtime/pkg/types"
	"github.com/go-chi/chi/v5"
	"github.com/sirupsen/logrus"
)

// Handler implements the HTTP handlers for the runtime API
type Handler struct {
	service *service.RuntimeService
	log     *logrus.Logger
}

// NewHandler creates a new handler
func NewHandler(service *service.RuntimeService, log *logrus.Logger) *Handler {
	return &Handler{
		service: service,
		log:     log,
	}
}

// GetInput handles GET /executions/{id}/input
func (h *Handler) GetInput(w http.ResponseWriter, r *http.Request) {
	executionID := chi.URLParam(r, "id")
	
	// Verify token matches execution
	claims, _ := middleware.GetTokenClaims(r.Context())
	if claims.ExecutionID != executionID {
		h.writeError(w, http.StatusForbidden, "execution ID mismatch")
		return
	}

	input, err := h.service.GetInput(r.Context(), executionID)
	if err != nil {
		h.log.WithError(err).Error("Failed to get input")
		h.writeError(w, http.StatusInternalServerError, "failed to get input")
		return
	}

	h.writeJSON(w, http.StatusOK, types.SuccessResponse{
		Success: true,
		Data:    input,
	})
}

// SetOutput handles POST /executions/{id}/output
func (h *Handler) SetOutput(w http.ResponseWriter, r *http.Request) {
	executionID := chi.URLParam(r, "id")
	
	// Verify token matches execution
	claims, _ := middleware.GetTokenClaims(r.Context())
	if claims.ExecutionID != executionID {
		h.writeError(w, http.StatusForbidden, "execution ID mismatch")
		return
	}

	var body struct {
		Data interface{} `json:"data"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.SetOutput(r.Context(), executionID, body.Data); err != nil {
		h.log.WithError(err).Error("Failed to set output")
		h.writeError(w, http.StatusInternalServerError, "failed to set output")
		return
	}

	h.writeJSON(w, http.StatusOK, types.SuccessResponse{
		Success: true,
	})
}

// GetVariable handles GET /executions/{id}/variables/{key}
func (h *Handler) GetVariable(w http.ResponseWriter, r *http.Request) {
	executionID := chi.URLParam(r, "id")
	key := chi.URLParam(r, "key")
	
	// Verify token matches execution
	claims, _ := middleware.GetTokenClaims(r.Context())
	if claims.ExecutionID != executionID {
		h.writeError(w, http.StatusForbidden, "execution ID mismatch")
		return
	}

	value, err := h.service.GetVariable(r.Context(), executionID, key)
	if err != nil {
		h.log.WithError(err).Error("Failed to get variable")
		h.writeError(w, http.StatusInternalServerError, "failed to get variable")
		return
	}

	h.writeJSON(w, http.StatusOK, types.SuccessResponse{
		Success: true,
		Data: map[string]interface{}{
			"key":   key,
			"value": value,
		},
	})
}

// SetVariable handles PUT /executions/{id}/variables/{key}
func (h *Handler) SetVariable(w http.ResponseWriter, r *http.Request) {
	executionID := chi.URLParam(r, "id")
	key := chi.URLParam(r, "key")
	
	// Verify token matches execution
	claims, _ := middleware.GetTokenClaims(r.Context())
	if claims.ExecutionID != executionID {
		h.writeError(w, http.StatusForbidden, "execution ID mismatch")
		return
	}

	var body struct {
		Value interface{} `json:"value"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.SetVariable(r.Context(), executionID, key, body.Value); err != nil {
		h.log.WithError(err).Error("Failed to set variable")
		h.writeError(w, http.StatusInternalServerError, "failed to set variable")
		return
	}

	h.writeJSON(w, http.StatusOK, types.SuccessResponse{
		Success: true,
	})
}

// SetCondition handles POST /executions/{id}/condition
func (h *Handler) SetCondition(w http.ResponseWriter, r *http.Request) {
	executionID := chi.URLParam(r, "id")
	
	// Verify token matches execution
	claims, _ := middleware.GetTokenClaims(r.Context())
	if claims.ExecutionID != executionID {
		h.writeError(w, http.StatusForbidden, "execution ID mismatch")
		return
	}

	var body struct {
		Condition bool `json:"condition"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.SetCondition(r.Context(), executionID, body.Condition); err != nil {
		h.log.WithError(err).Error("Failed to set condition")
		h.writeError(w, http.StatusInternalServerError, "failed to set condition")
		return
	}

	h.writeJSON(w, http.StatusOK, types.SuccessResponse{
		Success: true,
	})
}

// GetContext handles GET /executions/{id}/context
func (h *Handler) GetContext(w http.ResponseWriter, r *http.Request) {
	executionID := chi.URLParam(r, "id")
	
	// Verify token matches execution
	claims, _ := middleware.GetTokenClaims(r.Context())
	if claims.ExecutionID != executionID {
		h.writeError(w, http.StatusForbidden, "execution ID mismatch")
		return
	}

	context, err := h.service.GetEventContext(r.Context(), executionID)
	if err != nil {
		h.log.WithError(err).Error("Failed to get context")
		h.writeError(w, http.StatusInternalServerError, "failed to get context")
		return
	}

	h.writeJSON(w, http.StatusOK, types.SuccessResponse{
		Success: true,
		Data:    context,
	})
}

// ExecuteToolAction handles POST /tool-actions/execute
func (h *Handler) ExecuteToolAction(w http.ResponseWriter, r *http.Request) {
	// Get execution ID from token
	claims, _ := middleware.GetTokenClaims(r.Context())
	executionID := claims.ExecutionID

	var config types.ToolActionConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result, err := h.service.ExecuteToolAction(r.Context(), executionID, config)
	if err != nil {
		h.log.WithError(err).Error("Failed to execute tool action")
		h.writeError(w, http.StatusInternalServerError, "failed to execute tool action")
		return
	}

	h.writeJSON(w, http.StatusOK, result)
}

// Health handles GET /health
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "healthy",
		"time":   r.Context().Value("requestTime"),
	})
}

// writeJSON writes a JSON response
func (h *Handler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	
	if err := json.NewEncoder(w).Encode(data); err != nil {
		h.log.WithError(err).Error("Failed to encode response")
	}
}

// writeError writes an error response
func (h *Handler) writeError(w http.ResponseWriter, status int, message string) {
	h.writeJSON(w, status, types.ErrorResponse{
		Error:   http.StatusText(status),
		Message: message,
	})
}
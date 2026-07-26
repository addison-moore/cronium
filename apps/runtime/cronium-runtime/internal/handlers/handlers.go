package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/addison-moore/cronium/apps/runtime/internal/middleware"
	"github.com/addison-moore/cronium/apps/runtime/internal/service"
	"github.com/addison-moore/cronium/apps/runtime/pkg/types"
	"github.com/go-chi/chi/v5"
	"github.com/sirupsen/logrus"
)

// maxOutputBytes caps the request body accepted by POST /executions/{id}/output.
// It mirrors the app's own limit on the relayed write (the internal
// executions/{id}/output route rejects larger outputs with 413 "Output exceeds
// the 5242880-byte limit" — see tests/fixtures/internal-api/executions-output.json),
// so the runtime fails fast with an honest 413 instead of shipping an
// over-limit body upstream and mapping the app's 413 to a generic 500.
const maxOutputBytes = 5242880 // 5 MiB

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
	claims, ok := middleware.GetTokenClaims(r.Context())
	if !ok {
		h.writeError(w, http.StatusUnauthorized, "missing or invalid execution token")
		return
	}
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
	claims, ok := middleware.GetTokenClaims(r.Context())
	if !ok {
		h.writeError(w, http.StatusUnauthorized, "missing or invalid execution token")
		return
	}
	if claims.ExecutionID != executionID {
		h.writeError(w, http.StatusForbidden, "execution ID mismatch")
		return
	}

	var body struct {
		Data interface{} `json:"data"`
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxOutputBytes)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			h.writeError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("output exceeds the %d-byte limit", maxOutputBytes))
			return
		}
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
	claims, ok := middleware.GetTokenClaims(r.Context())
	if !ok {
		h.writeError(w, http.StatusUnauthorized, "missing or invalid execution token")
		return
	}
	h.log.WithFields(logrus.Fields{
		"urlExecutionID":    executionID,
		"claimsExecutionID": claims.ExecutionID,
		"hasToken":          ok,
		"key":               key,
	}).Debug("GetVariable request")

	if claims.ExecutionID != executionID {
		h.log.WithFields(logrus.Fields{
			"urlExecutionID":    executionID,
			"claimsExecutionID": claims.ExecutionID,
		}).Error("Execution ID mismatch")
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
	claims, ok := middleware.GetTokenClaims(r.Context())
	if !ok {
		h.writeError(w, http.StatusUnauthorized, "missing or invalid execution token")
		return
	}
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
	claims, ok := middleware.GetTokenClaims(r.Context())
	if !ok {
		h.writeError(w, http.StatusUnauthorized, "missing or invalid execution token")
		return
	}
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
	claims, ok := middleware.GetTokenClaims(r.Context())
	if !ok {
		h.writeError(w, http.StatusUnauthorized, "missing or invalid execution token")
		return
	}
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

// ExecuteToolAction handles POST /tool-actions/execute — a script invoking a
// tool action via cronium.toolAction() (and the slack/discord/email wrappers).
//
// The script sends {tool, action, config}; we relay to the app's
// POST /api/internal/tools/execute (see service.BackendClient.ExecuteToolAction),
// which resolves the caller's tool credential, runs the action through the
// scheduler's hardened engine, and returns a ToolActionResult. The app-minted
// per-job capability is carried on the outbound request by the backend client
// (X-Job-Capability), so the app authorizes this against the running job.
func (h *Handler) ExecuteToolAction(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetTokenClaims(r.Context())
	if !ok {
		h.writeError(w, http.StatusUnauthorized, "missing or invalid execution token")
		return
	}

	// The script sends the action config under `config`; map it to the Params
	// field the app route expects (the wire key is `params`).
	var body struct {
		Tool   string                 `json:"tool"`
		Action string                 `json:"action"`
		Config map[string]interface{} `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Tool == "" || body.Action == "" {
		h.writeError(w, http.StatusBadRequest, "tool and action are required")
		return
	}

	result, err := h.service.ExecuteToolAction(r.Context(), claims.ExecutionID, types.ToolActionConfig{
		Tool:   body.Tool,
		Action: body.Action,
		Params: body.Config,
	})
	if err != nil {
		h.log.WithError(err).Error("Tool action failed")
		h.writeError(w, http.StatusBadGateway, "tool action failed: "+err.Error())
		return
	}
	// The action reached the tool but reported failure — surface it as an error
	// so the script's cronium.toolAction() rejects rather than returning null.
	if !result.Success {
		msg := result.Error
		if msg == "" {
			msg = "tool action failed"
		}
		h.writeError(w, http.StatusBadGateway, msg)
		return
	}

	h.writeJSON(w, http.StatusOK, types.SuccessResponse{
		Success: true,
		Data:    result.Data,
	})
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

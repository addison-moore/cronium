package middleware

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMaxBodySizeStopsReadingAtTheLimit(t *testing.T) {
	var readErr error
	handler := MaxBodySize(10)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, readErr = io.ReadAll(r.Body)
	}))

	handler.ServeHTTP(
		httptest.NewRecorder(),
		httptest.NewRequest(http.MethodPost, "/", strings.NewReader(strings.Repeat("x", 11))),
	)
	var tooLarge *http.MaxBytesError
	if !errors.As(readErr, &tooLarge) {
		t.Fatalf("expected a MaxBytesError, got %v", readErr)
	}

	handler.ServeHTTP(
		httptest.NewRecorder(),
		httptest.NewRequest(http.MethodPost, "/", strings.NewReader(strings.Repeat("x", 10))),
	)
	if readErr != nil {
		t.Fatalf("a body at the limit must be read, got %v", readErr)
	}
}

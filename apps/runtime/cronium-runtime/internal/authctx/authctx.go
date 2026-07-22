// Package authctx carries the per-job capability token (HI-10) on a request
// context so the outbound BackendClient can present it as an X-Job-Capability
// header without threading it through every service/method signature.
//
// The capability is minted by the app at job claim time, embedded by the
// orchestrator in the execution JWT, extracted by AuthMiddleware after JWT
// validation, and read here by newRequest. It is opaque to the runtime.
package authctx

import "context"

type capabilityKey struct{}

// WithCapability returns a context carrying the per-job capability token. An
// empty token is a no-op.
func WithCapability(ctx context.Context, token string) context.Context {
	if token == "" {
		return ctx
	}
	return context.WithValue(ctx, capabilityKey{}, token)
}

// CapabilityFromContext returns the capability token carried by ctx, or "".
func CapabilityFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(capabilityKey{}).(string); ok {
		return v
	}
	return ""
}

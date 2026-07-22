package api

import "context"

// capabilityKey is the context key under which a job's per-job capability token
// (HI-10) travels. The token is minted by the app at claim time and presented
// in the X-Job-Capability header on that job's status/complete/fail/logs and
// execution create/update calls, replacing the shared internal key for those
// routes.
type capabilityCtxKey struct{}

// WithJobCapability returns a context carrying the given per-job capability
// token. An empty token is a no-op (the request then carries no capability
// header, and the job-scoped routes reject it — fail closed).
func WithJobCapability(ctx context.Context, token string) context.Context {
	if token == "" {
		return ctx
	}
	return context.WithValue(ctx, capabilityCtxKey{}, token)
}

// jobCapabilityFromContext returns the capability token carried by ctx, or "".
func jobCapabilityFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(capabilityCtxKey{}).(string); ok {
		return v
	}
	return ""
}

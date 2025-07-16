package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/addison-more/cronium/runtime/internal/config"
	"github.com/addison-more/cronium/runtime/pkg/types"
	"github.com/redis/go-redis/v9"
)

// ValkeyClient wraps the Redis client for Valkey compatibility
type ValkeyClient struct {
	client *redis.Client
	ttl    time.Duration
}

// NewValkeyClient creates a new Valkey client
func NewValkeyClient(cfg config.CacheConfig) (*ValkeyClient, error) {
	// Parse Valkey URL (valkey:// is compatible with redis://)
	opt, err := redis.ParseURL(cfg.URL)
	if err != nil {
		// If parsing fails, try with redis:// prefix
		redisURL := "redis" + cfg.URL[6:] // Replace "valkey" with "redis"
		opt, err = redis.ParseURL(redisURL)
		if err != nil {
			return nil, fmt.Errorf("failed to parse Valkey URL: %w", err)
		}
	}

	// Apply additional configuration
	opt.Password = cfg.Password
	opt.DB = cfg.DB
	opt.MaxRetries = cfg.MaxRetries
	opt.DialTimeout = cfg.DialTimeout
	opt.ReadTimeout = cfg.ReadTimeout
	opt.WriteTimeout = cfg.WriteTimeout
	opt.PoolSize = cfg.PoolSize
	opt.MinIdleConns = cfg.MinIdleConns
	opt.ConnMaxLifetime = cfg.MaxConnAge

	client := redis.NewClient(opt)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Valkey: %w", err)
	}

	return &ValkeyClient{
		client: client,
		ttl:    cfg.TTL,
	}, nil
}

// Close closes the Valkey connection
func (c *ValkeyClient) Close() error {
	return c.client.Close()
}

// GetVariable retrieves a variable from cache
func (c *ValkeyClient) GetVariable(ctx context.Context, executionID, key string) (*types.Variable, error) {
	cacheKey := types.CacheKey{
		Type:        "variable",
		ExecutionID: executionID,
		Key:         key,
	}

	data, err := c.client.Get(ctx, cacheKey.String()).Result()
	if err == redis.Nil {
		return nil, nil // Not found
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get variable from cache: %w", err)
	}

	var variable types.Variable
	if err := json.Unmarshal([]byte(data), &variable); err != nil {
		return nil, fmt.Errorf("failed to unmarshal variable: %w", err)
	}

	return &variable, nil
}

// SetVariable stores a variable in cache
func (c *ValkeyClient) SetVariable(ctx context.Context, executionID, key string, variable *types.Variable) error {
	cacheKey := types.CacheKey{
		Type:        "variable",
		ExecutionID: executionID,
		Key:         key,
	}

	data, err := json.Marshal(variable)
	if err != nil {
		return fmt.Errorf("failed to marshal variable: %w", err)
	}

	if err := c.client.Set(ctx, cacheKey.String(), data, c.ttl).Err(); err != nil {
		return fmt.Errorf("failed to set variable in cache: %w", err)
	}

	return nil
}

// GetInput retrieves input data from cache
func (c *ValkeyClient) GetInput(ctx context.Context, executionID string) (*types.InputData, error) {
	cacheKey := types.CacheKey{
		Type:        "input",
		ExecutionID: executionID,
	}

	data, err := c.client.Get(ctx, cacheKey.String()).Result()
	if err == redis.Nil {
		return nil, nil // Not found
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get input from cache: %w", err)
	}

	var input types.InputData
	if err := json.Unmarshal([]byte(data), &input); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	return &input, nil
}

// SetInput stores input data in cache
func (c *ValkeyClient) SetInput(ctx context.Context, executionID string, input *types.InputData) error {
	cacheKey := types.CacheKey{
		Type:        "input",
		ExecutionID: executionID,
	}

	data, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("failed to marshal input: %w", err)
	}

	if err := c.client.Set(ctx, cacheKey.String(), data, c.ttl).Err(); err != nil {
		return fmt.Errorf("failed to set input in cache: %w", err)
	}

	return nil
}

// GetOutput retrieves output data from cache
func (c *ValkeyClient) GetOutput(ctx context.Context, executionID string) (*types.OutputData, error) {
	cacheKey := types.CacheKey{
		Type:        "output",
		ExecutionID: executionID,
	}

	data, err := c.client.Get(ctx, cacheKey.String()).Result()
	if err == redis.Nil {
		return nil, nil // Not found
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get output from cache: %w", err)
	}

	var output types.OutputData
	if err := json.Unmarshal([]byte(data), &output); err != nil {
		return nil, fmt.Errorf("failed to unmarshal output: %w", err)
	}

	return &output, nil
}

// SetOutput stores output data in cache
func (c *ValkeyClient) SetOutput(ctx context.Context, executionID string, output *types.OutputData) error {
	cacheKey := types.CacheKey{
		Type:        "output",
		ExecutionID: executionID,
	}

	data, err := json.Marshal(output)
	if err != nil {
		return fmt.Errorf("failed to marshal output: %w", err)
	}

	if err := c.client.Set(ctx, cacheKey.String(), data, c.ttl).Err(); err != nil {
		return fmt.Errorf("failed to set output in cache: %w", err)
	}

	return nil
}

// GetContext retrieves execution context from cache
func (c *ValkeyClient) GetContext(ctx context.Context, executionID string) (*types.ExecutionContext, error) {
	cacheKey := types.CacheKey{
		Type:        "context",
		ExecutionID: executionID,
	}

	data, err := c.client.Get(ctx, cacheKey.String()).Result()
	if err == redis.Nil {
		return nil, nil // Not found
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get context from cache: %w", err)
	}

	var execContext types.ExecutionContext
	if err := json.Unmarshal([]byte(data), &execContext); err != nil {
		return nil, fmt.Errorf("failed to unmarshal context: %w", err)
	}

	return &execContext, nil
}

// SetContext stores execution context in cache
func (c *ValkeyClient) SetContext(ctx context.Context, executionID string, execContext *types.ExecutionContext) error {
	cacheKey := types.CacheKey{
		Type:        "context",
		ExecutionID: executionID,
	}

	data, err := json.Marshal(execContext)
	if err != nil {
		return fmt.Errorf("failed to marshal context: %w", err)
	}

	if err := c.client.Set(ctx, cacheKey.String(), data, c.ttl).Err(); err != nil {
		return fmt.Errorf("failed to set context in cache: %w", err)
	}

	return nil
}

// InvalidateExecution removes all cached data for an execution
func (c *ValkeyClient) InvalidateExecution(ctx context.Context, executionID string) error {
	// Use pattern matching to delete all keys for this execution
	pattern := "*:" + executionID + "*"
	
	var cursor uint64
	for {
		keys, nextCursor, err := c.client.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return fmt.Errorf("failed to scan keys: %w", err)
		}

		if len(keys) > 0 {
			if err := c.client.Del(ctx, keys...).Err(); err != nil {
				return fmt.Errorf("failed to delete keys: %w", err)
			}
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	return nil
}

// Lock acquires a distributed lock for the given key
func (c *ValkeyClient) Lock(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	lockKey := "lock:" + key
	
	// Try to set the lock with NX (only if not exists)
	ok, err := c.client.SetNX(ctx, lockKey, "1", ttl).Result()
	if err != nil {
		return false, fmt.Errorf("failed to acquire lock: %w", err)
	}
	
	return ok, nil
}

// Unlock releases a distributed lock
func (c *ValkeyClient) Unlock(ctx context.Context, key string) error {
	lockKey := "lock:" + key
	
	if err := c.client.Del(ctx, lockKey).Err(); err != nil {
		return fmt.Errorf("failed to release lock: %w", err)
	}
	
	return nil
}
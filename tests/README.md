# Cronium Test Suite

Comprehensive test suite for the Cronium containerized execution system.

## Test Categories

### Unit Tests (`/unit`)

- **job-service.test.ts** - Tests for job queue operations
- **logs-websocket.test.ts** - Tests for WebSocket log streaming

### Integration Tests (`/integration`)

- **job-execution-flow.test.ts** - End-to-end job execution workflow

### Performance Tests (`/performance`)

- **benchmark.test.ts** - Performance benchmarks and stress tests

### Security Tests (`/security`)

- **security-validation.test.ts** - Security validation and penetration tests

## Running Tests

### All Tests

```bash
npm test
```

### Specific Test Category

```bash
# Unit tests only
npm test -- --selectProjects="Unit Tests"

# Integration tests only
npm test -- --selectProjects="Integration Tests"

# Performance tests only
npm test -- --selectProjects="Performance Tests"

# Security tests only
npm test -- --selectProjects="Security Tests"
```

### Individual Test Files

```bash
# Run specific test file
npm test -- tests/unit/job-service.test.ts

# Run with coverage
npm test -- --coverage tests/unit/job-service.test.ts

# Run in watch mode
npm test -- --watch tests/unit/job-service.test.ts
```

## Environment Setup

### Test Database

Create a `.env.test` file with test-specific configuration:

```env
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/cronium_test
JWT_SECRET=test-jwt-secret
INTERNAL_API_KEY=test-internal-api-key
TEST_AUTH_TOKEN=test-auth-token
```

### Docker Services

Some tests require running services:

```bash
# Start test dependencies
docker-compose -f docker-compose.test.yml up -d

# PostgreSQL for database tests
# Valkey/Redis for caching tests
# Runtime API service for integration tests
```

## Writing Tests

### Test Structure

```typescript
describe("Feature Name", () => {
  beforeAll(async () => {
    // Setup test data
  });

  afterAll(async () => {
    // Cleanup
  });

  describe("Specific Functionality", () => {
    it("should behave correctly", async () => {
      // Test implementation
    });
  });
});
```

### Test Utilities

Global utilities are available in all tests:

```typescript
// Wait for condition
await testUtils.waitFor(() => job.status === "completed");

// Add delay
await testUtils.delay(1000);

// Generate unique ID
const id = testUtils.uniqueId("user");
```

### Custom Matchers

```typescript
// Check if value is within range
expect(responseTime).toBeWithinRange(100, 500);
```

## Performance Benchmarks

Performance tests output benchmark summaries:

```
=== Performance Benchmark Summary ===

Operation               Avg Time (ms)  Min Time (ms)  Max Time (ms)  Ops/Second
Job Creation           15.23          12.45          23.67          65
Job Claiming (10)      45.78          38.92          67.23          21
Job Status Update      8.34           6.78           12.45          119
```

## Security Testing

Security tests validate:

- Authentication and authorization
- Input validation and sanitization
- SQL injection prevention
- XSS protection
- Rate limiting
- Data encryption
- CORS policies

## Coverage Reports

Generate coverage reports:

```bash
# Generate coverage
npm test -- --coverage

# View HTML report
open coverage/lcov-report/index.html
```

## CI/CD Integration

Tests are automatically run in CI/CD pipeline:

1. Unit tests run on every commit
2. Integration tests run on pull requests
3. Performance tests run nightly
4. Security tests run before releases

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Ensure PostgreSQL is running
   - Check TEST_DATABASE_URL is correct
   - Run migrations: `npm run db:push`

2. **WebSocket Connection Failed**
   - Check Socket.IO server is running
   - Verify port 5002 is available

3. **Performance Test Timeouts**
   - Increase test timeout in jest.config.js
   - Check system resources

4. **Security Test Failures**
   - Ensure JWT_SECRET matches app configuration
   - Verify INTERNAL_API_KEY is set

## Best Practices

1. **Isolation** - Tests should not depend on each other
2. **Cleanup** - Always clean up test data
3. **Mocking** - Mock external dependencies
4. **Assertions** - Use specific assertions
5. **Performance** - Keep tests fast
6. **Security** - Never commit real credentials

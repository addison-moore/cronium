# Environment Variables Audit Report

Generated on: 2025-07-12

## Summary

This audit reveals several environment variable management issues:

- Multiple inconsistent naming patterns
- Variables used in code but not documented
- Variables documented but not used
- Duplicate/redundant variables

## Environment Variables by Source

### 1. Defined in src/env.mjs (Official Environment Schema)

These are the officially validated environment variables:

**Server-side:**

- `NODE_ENV` - Environment mode (development/test/production)
- `AUTH_SECRET` - NextAuth secret
- `AUTH_URL` - Authentication URL
- `SMTP_HOST` - SMTP server host
- `SMTP_PORT` - SMTP server port
- `SMTP_USER` - SMTP username
- `SMTP_PASSWORD` - SMTP password
- `SMTP_FROM_EMAIL` - From email address
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - OpenAI API key (optional)
- `PUBLIC_APP_URL` - Public application URL (optional)
- `ENCRYPTION_MASTER_KEY` - Master encryption key

**Client-side:**

- `PUBLIC_APP_URL` - Public application URL

**Special:**

- `SKIP_ENV_VALIDATION` - Skip environment validation

### 2. Used in Code but NOT in env.mjs

These variables are referenced in the codebase but not validated:

**Authentication/OAuth:**

- `OAUTH_MICROSOFT_TENANT_ID` - Microsoft OAuth tenant ID

**Security:**

- `INTERNAL_API_TOKEN` - Internal API authentication
- `CREDENTIAL_ENCRYPTION_KEY` - Credential encryption key (duplicate of ENCRYPTION_MASTER_KEY?)

**Services:**

- `ORCHESTRATOR_URL` - Orchestrator service URL
- `RUNTIME_API_URL` - Runtime API service URL
- `SERVICE_DISCOVERY_CONFIG` - Service discovery configuration

**WebSocket:**

- `NEXT_PUBLIC_SOCKET_PORT` - Socket.io port (client-side)
- `NEXT_PUBLIC_SOCKET_URL` - Socket.io URL (client-side)

**System:**

- `HOME` - User home directory
- `SHELL` - User shell
- `USERPROFILE` - Windows user profile
- `PORT` - Server port
- `VERCEL_URL` - Vercel deployment URL

**Legacy/Incorrect:**

- `SMTP_PASS` (should be `SMTP_PASSWORD`)
- `EXAMPLE_API_KEY` - Example in templates

### 3. Docker Compose Environment Variables

**Production (docker-compose.yml):**

- Database: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `POSTGRES_MAX_CONNECTIONS`, `DB_SSL_MODE`
- Valkey: `VALKEY_PORT`, `VALKEY_MAX_MEMORY`, `VALKEY_URL`
- Auth: `AUTH_URL`, `AUTH_SECRET`, `JWT_SECRET`
- Services: `ORCHESTRATOR_URL`, `INTERNAL_API_KEY`
- Ports: `APP_PORT`, `SOCKET_PORT`
- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
- Build: `BUILD_VERSION`, `NODE_ENV`, `LOG_LEVEL`
- Orchestrator: `ORCHESTRATOR_ID`, `MAX_CONCURRENT_JOBS`, `JOB_POLL_INTERVAL`
- Encryption: `ENCRYPTION_KEY`

### 4. Orchestrator-Specific Variables

The Go orchestrator uses the `CRONIUM_` prefix with envconfig:

- `CRONIUM_API_ENDPOINT` / `CRONIUM_API_URL` - Backend API URL
- `CRONIUM_API_TOKEN` / `CRONIUM_SERVICE_TOKEN` - API authentication
- `CRONIUM_WS_URL` - WebSocket URL
- `CRONIUM_JOBS_MAX_CONCURRENT` - Max concurrent jobs
- `CRONIUM_LOGGING_LEVEL` - Log level
- `CRONIUM_CONTAINER_RUNTIME_*` - Runtime configuration
- `CRONIUM_EXECUTION_*` - Execution context variables

## Issues Found

### 1. Naming Inconsistencies

- **SMTP Variables:**
  - env.mjs uses: `SMTP_FROM_EMAIL`
  - docker-compose uses: `SMTP_FROM`
  - seed script uses: `SMTP_PASS` (should be `SMTP_PASSWORD`)

- **Authentication:**
  - env.mjs uses: `AUTH_SECRET`, `AUTH_URL`
  - docker-compose also uses: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`

- **Encryption:**
  - env.mjs uses: `ENCRYPTION_MASTER_KEY`
  - docker-compose uses: `ENCRYPTION_KEY`
  - Code uses: `CREDENTIAL_ENCRYPTION_KEY`

### 2. Missing from env.mjs

Critical variables used in code but not validated:

- `INTERNAL_API_KEY` / `INTERNAL_API_TOKEN`
- `JWT_SECRET`
- `ORCHESTRATOR_URL`
- `RUNTIME_API_URL`
- `NEXT_PUBLIC_SOCKET_PORT`
- `NEXT_PUBLIC_SOCKET_URL`

### 3. Documented but Not Used

Variables in .env.example but not found in code:

- `NEXTAUTH_URL` / `NEXTAUTH_SECRET` (replaced by AUTH_URL/AUTH_SECRET)
- `RUNTIME_API_PORT`
- `RUNTIME_CACHE_TTL`
- `MAX_REQUEST_SIZE`
- `REQUEST_TIMEOUT`
- `DOCKER_REGISTRY` / `DOCKER_USERNAME` / `DOCKER_PASSWORD`
- `EMAIL_FROM` / `EMAIL_SERVER_*` (legacy naming)
- `LOCAL_EXEC_CONTAINER` / `LOCAL_EXEC_NETWORK`
- `EXECUTOR_CPU_LIMIT` / `EXECUTOR_MEMORY_LIMIT` / `EXECUTOR_TMPFS_SIZE`

### 4. Orchestrator Environment Mismatch

The orchestrator expects `CRONIUM_` prefixed variables via envconfig, but docker-compose provides unprefixed versions.

## Recommendations

1. **Consolidate Encryption Variables:**
   - Use a single `ENCRYPTION_KEY` variable
   - Remove duplicates: `ENCRYPTION_MASTER_KEY`, `CREDENTIAL_ENCRYPTION_KEY`

2. **Add Missing Variables to env.mjs:**

   ```javascript
   // Add to server section:
   INTERNAL_API_KEY: z.string(),
   JWT_SECRET: z.string(),
   ORCHESTRATOR_URL: z.string().url().optional(),
   RUNTIME_API_URL: z.string().url().optional(),

   // Add to client section:
   NEXT_PUBLIC_SOCKET_PORT: z.string().optional(),
   NEXT_PUBLIC_SOCKET_URL: z.string().url().optional(),
   ```

3. **Standardize Naming:**
   - Use `AUTH_*` prefix consistently (remove NEXTAUTH\_\*)
   - Use `SMTP_FROM_EMAIL` consistently
   - Fix `SMTP_PASS` → `SMTP_PASSWORD` in seed script

4. **Clean Up Unused Variables:**
   - Remove legacy variables from .env.example
   - Document which variables are actually required vs optional

5. **Fix Orchestrator Integration:**
   - Either update orchestrator to use unprefixed variables
   - Or update docker-compose to provide CRONIUM\_ prefixed variables

6. **Create Environment Documentation:**
   - Document each variable's purpose
   - Specify which services require which variables
   - Provide example values and formats

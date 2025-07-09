# Environment Variables

This document describes all environment variables used by the Cronium application.

## Table of Contents

- [Required Variables](#required-variables)
  - [Core Application](#core-application)
  - [Authentication](#authentication)
  - [Database](#database)
  - [Email Configuration](#email-configuration)
  - [Security](#security)
- [Optional Variables](#optional-variables)
  - [Integrations](#integrations)
  - [Server Configuration](#server-configuration)
  - [Development/Testing](#developmenttesting)
  - [Docker/Container](#dockercontainer)
- [Environment Variable Validation](#environment-variable-validation)
- [Example Configuration](#example-configuration)

## Required Variables

These environment variables must be set for the application to function correctly.

### Core Application

#### `NODE_ENV`

- **Description**: Determines the application environment
- **Type**: `string`
- **Values**: `development`, `test`, `production`
- **Example**: `NODE_ENV="development"`
- **Used in**: Application configuration, logging, feature toggles

#### `NEXT_PUBLIC_APP_URL`

- **Description**: The public URL of the application
- **Type**: `string` (URL)
- **Example**: `NEXT_PUBLIC_APP_URL="http://localhost:5001"`
- **Used in**: Client-side components, webhook URLs, OAuth callbacks
- **Note**: Must be prefixed with `NEXT_PUBLIC_` to be accessible in the browser

### Authentication

#### `AUTH_SECRET`

- **Description**: Secret key for NextAuth.js session encryption and JWT signing
- **Type**: `string` (min 32 characters recommended)
- **Example**: `AUTH_SECRET="your-secret-key-here"`
- **Used in**: NextAuth configuration
- **Note**: Generate with `openssl rand -base64 32`

#### `AUTH_URL`

- **Description**: The base URL for authentication callbacks
- **Type**: `string` (URL)
- **Example**: `AUTH_URL="http://localhost:5001"`
- **Used in**: NextAuth configuration
- **Note**: Should match your application URL

### Database

#### `DATABASE_URL`

- **Description**: PostgreSQL connection string
- **Type**: `string` (PostgreSQL connection URL)
- **Example**: `DATABASE_URL="postgresql://user:password@localhost:5432/cronium?sslmode=require"`
- **Used in**: Database connections via Drizzle ORM
- **Note**: For Neon database, include `?sslmode=require`

### Email Configuration

#### `EMAIL_SERVER_HOST`

- **Description**: SMTP server hostname
- **Type**: `string`
- **Example**: `EMAIL_SERVER_HOST="smtp.gmail.com"`
- **Used in**: Email sending functionality

#### `EMAIL_SERVER_PORT`

- **Description**: SMTP server port
- **Type**: `string` (numeric)
- **Example**: `EMAIL_SERVER_PORT="465"` (for SSL) or `"587"` (for TLS)
- **Used in**: Email server configuration

#### `EMAIL_SERVER_USER`

- **Description**: SMTP authentication username
- **Type**: `string`
- **Example**: `EMAIL_SERVER_USER="your-email@gmail.com"`
- **Used in**: Email authentication

#### `EMAIL_SERVER_PASSWORD`

- **Description**: SMTP authentication password
- **Type**: `string`
- **Example**: `EMAIL_SERVER_PASSWORD="your-app-password"`
- **Used in**: Email authentication
- **Note**: For Gmail, use an app-specific password

#### `EMAIL_FROM`

- **Description**: Default "from" address for sent emails
- **Type**: `string` (email)
- **Example**: `EMAIL_FROM="noreply@yourdomain.com"`
- **Used in**: Email headers

### Security

#### `ENCRYPTION_MASTER_KEY`

- **Description**: Master key for encrypting sensitive data at rest
- **Type**: `string` (exactly 32 characters for AES-256)
- **Example**: `ENCRYPTION_MASTER_KEY="32-character-encryption-key-here"`
- **Used in**: Credential encryption service
- **Note**: Generate with `openssl rand -base64 24 | head -c 32`

## Optional Variables

These environment variables are optional and have default values or can be configured through other means.

### Integrations

#### `OPENAI_API_KEY`

- **Description**: OpenAI API key for AI features
- **Type**: `string`
- **Default**: Not set (AI features disabled)
- **Example**: `OPENAI_API_KEY="sk-..."`
- **Used in**: AI code generation features

#### `GEMINI_MODEL`

- **Description**: Google Gemini model identifier
- **Type**: `string`
- **Default**: Not set
- **Example**: `GEMINI_MODEL="gemini-2.0-flash"`
- **Used in**: AI features (if configured)

#### `GOOGLE_CLOUD_PROJECT`

- **Description**: Google Cloud project ID
- **Type**: `string`
- **Default**: Not set
- **Example**: `GOOGLE_CLOUD_PROJECT="my-project-123"`
- **Used in**: Google service integrations

### Server Configuration

#### `SOCKET_PORT`

- **Description**: Port for Socket.IO WebSocket server
- **Type**: `string` (numeric)
- **Default**: `"5002"`
- **Example**: `SOCKET_PORT="5002"`
- **Used in**: Terminal WebSocket connections

#### `HOST_URL`

- **Description**: Override host URL for specific deployments
- **Type**: `string` (URL)
- **Default**: Uses `NEXT_PUBLIC_APP_URL`
- **Example**: `HOST_URL="https://api.yourdomain.com"`
- **Used in**: Internal API calls

### Development/Testing

#### `API_KEY`

- **Description**: API key for testing/development
- **Type**: `string`
- **Default**: Not set
- **Used in**: Development testing

#### `RECIPIENT_EMAIL`

- **Description**: Test email recipient
- **Type**: `string` (email)
- **Default**: Not set
- **Used in**: Email testing

#### `DATA_DIR`

- **Description**: Data directory path
- **Type**: `string` (path)
- **Default**: Not set
- **Used in**: File operations

#### `OUTPUT_DIR`

- **Description**: Output directory path
- **Type**: `string` (path)
- **Default**: Not set
- **Used in**: File generation

#### `SKIP_ENV_VALIDATION`

- **Description**: Skip environment variable validation
- **Type**: `string`
- **Default**: Not set
- **Values**: Any non-empty value to skip
- **Used in**: Build process
- **Warning**: Only use in development

### Docker/Container

These variables are defined for future container execution features (not yet implemented).

#### `LOCAL_EXEC_CONTAINER`

- **Description**: Docker container name for script execution
- **Type**: `string`
- **Default**: Not set
- **Example**: `LOCAL_EXEC_CONTAINER="cronium-executor"`

#### `LOCAL_EXEC_NETWORK`

- **Description**: Docker network name
- **Type**: `string`
- **Default**: Not set
- **Example**: `LOCAL_EXEC_NETWORK="cronium-network"`

#### `EXECUTOR_CPU_LIMIT`

- **Description**: CPU limit for executor containers
- **Type**: `string`
- **Default**: Not set
- **Example**: `EXECUTOR_CPU_LIMIT="2.0"`

#### `EXECUTOR_MEMORY_LIMIT`

- **Description**: Memory limit for executor containers
- **Type**: `string`
- **Default**: Not set
- **Example**: `EXECUTOR_MEMORY_LIMIT="2G"`

#### `EXECUTOR_TMPFS_SIZE`

- **Description**: Temporary filesystem size for containers
- **Type**: `string`
- **Default**: Not set
- **Example**: `EXECUTOR_TMPFS_SIZE="100M"`

## Environment Variable Validation

The application uses `@t3-oss/env-nextjs` with Zod schemas to validate environment variables at build time and runtime. The validation is defined in `src/env.mjs`.

### Validation Features:

- Type checking
- Required vs optional validation
- Format validation (URLs, emails, etc.)
- Build-time validation to catch errors early
- Runtime validation for dynamic values

### Adding New Variables:

1. Add the variable to `src/env.mjs` with appropriate Zod schema
2. Update this documentation
3. Add to `.env.example` file

## Example Configuration

### Development Environment (.env.local)

```bash
# Core
NODE_ENV="development"
NEXT_PUBLIC_APP_URL="http://localhost:5001"

# Authentication
AUTH_SECRET="development-secret-key-32-chars-long"
AUTH_URL="http://localhost:5001"

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/cronium_dev"

# Email (using Gmail)
EMAIL_SERVER_HOST="smtp.gmail.com"
EMAIL_SERVER_PORT="465"
EMAIL_SERVER_USER="your-email@gmail.com"
EMAIL_SERVER_PASSWORD="your-app-password"
EMAIL_FROM="Cronium Dev <your-email@gmail.com>"

# Security
ENCRYPTION_MASTER_KEY="dev-encryption-key-32-characters"

# Optional
SOCKET_PORT="5002"
OPENAI_API_KEY="sk-..." # If using AI features
```

### Production Environment

```bash
# Core
NODE_ENV="production"
NEXT_PUBLIC_APP_URL="https://cronium.yourdomain.com"

# Authentication
AUTH_SECRET="<generate-secure-random-key>"
AUTH_URL="https://cronium.yourdomain.com"

# Database
DATABASE_URL="postgresql://user:password@db.neon.tech/cronium?sslmode=require"

# Email
EMAIL_SERVER_HOST="smtp.sendgrid.net"
EMAIL_SERVER_PORT="587"
EMAIL_SERVER_USER="apikey"
EMAIL_SERVER_PASSWORD="<sendgrid-api-key>"
EMAIL_FROM="Cronium <noreply@yourdomain.com>"

# Security
ENCRYPTION_MASTER_KEY="<generate-secure-encryption-key>"

# Optional
SOCKET_PORT="5002"
```

## Notes

1. **Security**: Never commit `.env` files to version control. Use `.env.example` for templates.
2. **Client-side Variables**: Variables needed in the browser must be prefixed with `NEXT_PUBLIC_`
3. **Migration**: The app is migrating from `NEXTAUTH_*` to `AUTH_*` prefixed variables
4. **Defaults**: Many optional variables have sensible defaults or can be configured via database settings
5. **Docker Variables**: Container-related variables are prepared for future containerization features

#!/bin/bash
set -e

echo "==================================="
echo "Phase 2: Schema Migration"
echo "Neon → PostgreSQL"
echo "==================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env.migration exists
if [ ! -f .env.migration ]; then
    echo -e "${RED}Error: .env.migration file not found!${NC}"
    exit 1
fi

# Load environment variables
source .env.migration

# Validate environment variables
if [ -z "$NEW_DATABASE_URL" ]; then
    echo -e "${RED}Error: NEW_DATABASE_URL not set in .env.migration${NC}"
    exit 1
fi

# Find latest backup directory
LATEST_BACKUP=$(ls -t backups/migration-*/schema.sql 2>/dev/null | head -1)
if [ -z "$LATEST_BACKUP" ]; then
    echo -e "${RED}Error: No backup found! Run migrate-database.sh first.${NC}"
    exit 1
fi

BACKUP_DIR=$(dirname "$LATEST_BACKUP")
echo -e "${YELLOW}Using backup from: $BACKUP_DIR${NC}"

# Step 1: Drop existing schema in new database (if any)
echo -e "\n${YELLOW}Step 1: Preparing new database...${NC}"
echo "Dropping existing public schema (if exists)..."
psql "$NEW_DATABASE_URL" << EOF
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
EOF
echo -e "${GREEN}✓ Database prepared${NC}"

# Step 2: Apply schema to new database
echo -e "\n${YELLOW}Step 2: Applying schema to new database...${NC}"
psql "$NEW_DATABASE_URL" < "$BACKUP_DIR/schema.sql" 2>&1 | grep -E "(ERROR|NOTICE)" || true
echo -e "${GREEN}✓ Schema applied${NC}"

# Step 3: Verify schema creation
echo -e "\n${YELLOW}Step 3: Verifying schema...${NC}"

# Count tables
NEW_TABLE_COUNT=$(psql "$NEW_DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
echo "Tables created: $NEW_TABLE_COUNT"

# List all tables
echo -e "\nTables in new database:"
psql "$NEW_DATABASE_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;"

# Check for required tables
REQUIRED_TABLES=(
    "users"
    "events"
    "workflows"
    "servers"
    "logs"
    "workflow_executions"
    "tool_credentials"
    "templates"
)

MISSING_TABLES=()
for table in "${REQUIRED_TABLES[@]}"; do
    EXISTS=$(psql "$NEW_DATABASE_URL" -t -A -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table');")
    if [ "$EXISTS" != "t" ]; then
        MISSING_TABLES+=("$table")
    fi
done

if [ ${#MISSING_TABLES[@]} -eq 0 ]; then
    echo -e "${GREEN}✓ All required tables exist${NC}"
else
    echo -e "${RED}Missing tables: ${MISSING_TABLES[*]}${NC}"
    exit 1
fi

# Step 4: Check sequences
echo -e "\n${YELLOW}Step 4: Checking sequences...${NC}"
SEQUENCE_COUNT=$(psql "$NEW_DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM information_schema.sequences WHERE sequence_schema = 'public';")
echo "Sequences created: $SEQUENCE_COUNT"

# Step 5: Check constraints
echo -e "\n${YELLOW}Step 5: Checking constraints...${NC}"
CONSTRAINT_COUNT=$(psql "$NEW_DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = 'public';")
echo "Constraints created: $CONSTRAINT_COUNT"

# Step 6: Check indexes
echo -e "\n${YELLOW}Step 6: Checking indexes...${NC}"
INDEX_COUNT=$(psql "$NEW_DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';")
echo "Indexes created: $INDEX_COUNT"

# Create post-schema stats
cat > "$BACKUP_DIR/post-schema-stats.txt" << EOF
Schema Migration Statistics - $(date)
=====================================

Tables: $NEW_TABLE_COUNT
Sequences: $SEQUENCE_COUNT
Constraints: $CONSTRAINT_COUNT
Indexes: $INDEX_COUNT

Tables List:
$(psql "$NEW_DATABASE_URL" -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;")
EOF

echo -e "\n${GREEN}Phase 2 (Schema Migration) completed successfully!${NC}"
echo -e "${YELLOW}Schema statistics saved to: $BACKUP_DIR/post-schema-stats.txt${NC}"
echo
echo "Next steps:"
echo "1. Review the schema statistics"
echo "2. Run Phase 3 (Data Migration) with migrate-phase3-data.sh"
#!/bin/bash
set -e

echo "==================================="
echo "Phase 3: Data Migration"
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
LATEST_BACKUP=$(ls -t backups/migration-*/data.sql 2>/dev/null | head -1)
if [ -z "$LATEST_BACKUP" ]; then
    echo -e "${RED}Error: No backup found! Run migrate-database.sh first.${NC}"
    exit 1
fi

BACKUP_DIR=$(dirname "$LATEST_BACKUP")
echo -e "${YELLOW}Using backup from: $BACKUP_DIR${NC}"

# Step 1: Clear any existing data
echo -e "\n${YELLOW}Step 1: Preparing for data import...${NC}"
echo "Disabling foreign key checks temporarily..."
psql "$NEW_DATABASE_URL" -c "SET session_replication_role = 'replica';"

# Step 2: Import data
echo -e "\n${YELLOW}Step 2: Importing data...${NC}"
echo "This may take a few minutes depending on data size..."
psql "$NEW_DATABASE_URL" < "$BACKUP_DIR/data.sql" 2>&1 | grep -E "(ERROR|NOTICE|INSERT)" | tail -20 || true

# Re-enable foreign key checks
psql "$NEW_DATABASE_URL" -c "SET session_replication_role = 'origin';"
echo -e "${GREEN}✓ Data imported${NC}"

# Step 3: Reset sequences
echo -e "\n${YELLOW}Step 3: Resetting sequences...${NC}"
psql "$NEW_DATABASE_URL" << 'EOF'
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT 
            schemaname,
            tablename,
            pg_get_serial_sequence(schemaname||'.'||tablename, 'id') as seq_name
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = pg_tables.tablename 
            AND column_name = 'id'
        )
    LOOP
        IF r.seq_name IS NOT NULL THEN
            EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(id) FROM %I.%I), 0) + 1, false);', 
                r.seq_name, r.schemaname, r.tablename);
        END IF;
    END LOOP;
END $$;
EOF
echo -e "${GREEN}✓ Sequences reset${NC}"

# Step 4: Verify data migration
echo -e "\n${YELLOW}Step 4: Verifying data migration...${NC}"

# Get row counts for all tables
echo -e "\nTable row counts:"
psql "$NEW_DATABASE_URL" -c "
SELECT 
    table_name,
    (xpath('//text()', query_to_xml(format('SELECT COUNT(*) FROM %I', table_name), true, false, '')))[1]::text::int AS row_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;"

# Count total rows
TOTAL_ROWS=$(psql "$NEW_DATABASE_URL" -t -A -c "
SELECT SUM(row_count)::int FROM (
    SELECT (xpath('//text()', query_to_xml(format('SELECT COUNT(*) FROM %I', table_name), true, false, '')))[1]::text::int AS row_count
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
) counts;")

echo -e "\nTotal rows migrated: ${TOTAL_ROWS:-0}"

# Check specific important tables
echo -e "\n${YELLOW}Checking critical tables:${NC}"
for table in users events workflows servers logs; do
    COUNT=$(psql "$NEW_DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
    echo "$table: $COUNT rows"
done

# Step 5: Analyze tables for query optimization
echo -e "\n${YELLOW}Step 5: Analyzing tables for query optimization...${NC}"
psql "$NEW_DATABASE_URL" -c "ANALYZE;"
echo -e "${GREEN}✓ Tables analyzed${NC}"

# Create post-data stats
cat > "$BACKUP_DIR/post-data-stats.txt" << EOF
Data Migration Statistics - $(date)
====================================

Total rows migrated: ${TOTAL_ROWS:-0}

Table Row Counts:
$(psql "$NEW_DATABASE_URL" -t -A -c "
SELECT table_name || ': ' || (xpath('//text()', query_to_xml(format('SELECT COUNT(*) FROM %I', table_name), true, false, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;")
EOF

echo -e "\n${GREEN}Phase 3 (Data Migration) completed successfully!${NC}"
echo -e "${YELLOW}Data statistics saved to: $BACKUP_DIR/post-data-stats.txt${NC}"
echo
echo "Next steps:"
echo "1. Review the data statistics"
echo "2. Run Phase 4 (Application Configuration) with migrate-phase4-config.sh"
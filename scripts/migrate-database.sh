#!/bin/bash
set -e

echo "==================================="
echo "Database Migration Script"
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
    echo "Please create .env.migration with OLD_DATABASE_URL and NEW_DATABASE_URL"
    exit 1
fi

# Load environment variables
source .env.migration

# Validate environment variables
if [ -z "$OLD_DATABASE_URL" ] || [ "$OLD_DATABASE_URL" == "YOUR_NEON_DATABASE_URL_HERE" ]; then
    echo -e "${RED}Error: OLD_DATABASE_URL not set in .env.migration${NC}"
    exit 1
fi

if [ -z "$NEW_DATABASE_URL" ]; then
    echo -e "${RED}Error: NEW_DATABASE_URL not set in .env.migration${NC}"
    exit 1
fi

# Create backup directory
BACKUP_DIR="backups/migration-$(date +%Y%m%d-%H%M%S)"
mkdir -p $BACKUP_DIR

echo -e "${YELLOW}Backup directory: $BACKUP_DIR${NC}"

# Step 1: Test connections
echo -e "\n${YELLOW}Step 1: Testing database connections...${NC}"
echo "Testing OLD database connection..."
psql "$OLD_DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1 || {
    echo -e "${RED}Failed to connect to OLD database${NC}"
    exit 1
}
echo -e "${GREEN}✓ OLD database connection successful${NC}"

echo "Testing NEW database connection..."
psql "$NEW_DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1 || {
    echo -e "${RED}Failed to connect to NEW database${NC}"
    exit 1
}
echo -e "${GREEN}✓ NEW database connection successful${NC}"

# Step 2: Document current statistics
echo -e "\n${YELLOW}Step 2: Documenting current database statistics...${NC}"
cat > "$BACKUP_DIR/pre-migration-stats.txt" << EOF
Migration Statistics - $(date)
================================

Table Row Counts (OLD Database):
EOF

# Get row counts for all tables
psql "$OLD_DATABASE_URL" -t -A -c "
SELECT table_name || ': ' || COUNT(*) 
FROM information_schema.tables t
LEFT JOIN LATERAL (
    SELECT COUNT(*) FROM pg_class WHERE relname = t.table_name
) c ON true
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
GROUP BY table_name
ORDER BY table_name;" >> "$BACKUP_DIR/pre-migration-stats.txt" 2>/dev/null || echo "Could not get detailed stats"

# Get total table count
TABLE_COUNT=$(psql "$OLD_DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
echo -e "\nTotal tables: $TABLE_COUNT" >> "$BACKUP_DIR/pre-migration-stats.txt"

echo -e "${GREEN}✓ Statistics documented${NC}"

# Step 3: Backup schema
echo -e "\n${YELLOW}Step 3: Backing up database schema...${NC}"
pg_dump --schema-only --no-owner --no-privileges -d "$OLD_DATABASE_URL" > "$BACKUP_DIR/schema.sql" 2>/dev/null || {
    echo -e "${RED}Failed to backup schema${NC}"
    exit 1
}
echo -e "${GREEN}✓ Schema backed up to $BACKUP_DIR/schema.sql${NC}"

# Step 4: Backup data
echo -e "\n${YELLOW}Step 4: Backing up database data...${NC}"
pg_dump --data-only --no-owner --no-privileges -d "$OLD_DATABASE_URL" > "$BACKUP_DIR/data.sql" 2>/dev/null || {
    echo -e "${RED}Failed to backup data${NC}"
    exit 1
}
echo -e "${GREEN}✓ Data backed up to $BACKUP_DIR/data.sql${NC}"

# Step 5: Create full backup (schema + data)
echo -e "\n${YELLOW}Step 5: Creating complete backup...${NC}"
pg_dump --no-owner --no-privileges -d "$OLD_DATABASE_URL" > "$BACKUP_DIR/complete-backup.sql" 2>/dev/null || {
    echo -e "${RED}Failed to create complete backup${NC}"
    exit 1
}
echo -e "${GREEN}✓ Complete backup created${NC}"

# Calculate backup sizes
SCHEMA_SIZE=$(du -h "$BACKUP_DIR/schema.sql" | cut -f1)
DATA_SIZE=$(du -h "$BACKUP_DIR/data.sql" | cut -f1)
COMPLETE_SIZE=$(du -h "$BACKUP_DIR/complete-backup.sql" | cut -f1)

echo -e "\n${YELLOW}Backup Summary:${NC}"
echo "- Schema size: $SCHEMA_SIZE"
echo "- Data size: $DATA_SIZE"
echo "- Complete backup size: $COMPLETE_SIZE"
echo "- Total tables: $TABLE_COUNT"

echo -e "\n${GREEN}Phase 1 (Preparation) completed successfully!${NC}"
echo -e "${YELLOW}Backups stored in: $BACKUP_DIR${NC}"
echo
echo "Next steps:"
echo "1. Update OLD_DATABASE_URL in .env.migration with your Neon connection string"
echo "2. Review the backup files"
echo "3. Proceed with Phase 2 (Schema Migration) when ready"
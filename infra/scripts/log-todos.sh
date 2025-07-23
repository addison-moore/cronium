#!/usr/bin/env bash
# File: ./scripts/find_todos.sh
# Usage: bash ./scripts/find_todos.sh

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/todos.log"

command -v rg >/dev/null 2>&1 || {
  echo "❌  This script needs ripgrep (rg). Install it first." >&2
  exit 1
}

mkdir -p "$LOG_DIR"
: > "$LOG_FILE"   # truncate existing file

# Search only *.ts, *.tsx, *.go and honour .gitignore
rg --no-heading --line-number --column --fixed-strings "// TODO: " \
   --type-add 'ts:*.ts'  --type-add 'tsx:*.tsx'  --type-add 'go:*.go' \
   --type ts --type tsx --type go \
   "$PROJECT_ROOT" |
while IFS=: read -r filepath line col text; do
  # ────────────────────────────────────────────────────────────────────────
  # Remove everything up to and including the first “TODO:” (case-sensitive)
  # ────────────────────────────────────────────────────────────────────────
  todo_body="${text#*TODO: }"                 # strip prefix, keep text after “TODO: ”
  clean_todo="TODO: ${todo_body}"

  # Write to log
  echo "./${filepath#$PROJECT_ROOT/}"           >> "$LOG_FILE"
  printf "%s:%s  %s\n\n" "$line" "$col" "$clean_todo" >> "$LOG_FILE"
done

echo "✅  TODOs written to $LOG_FILE"

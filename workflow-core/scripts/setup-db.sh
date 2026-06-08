#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Docker-free database bootstrap for the workflow engine (macOS / Linux).
#
# Creates the `workflow` role and database on a locally running PostgreSQL
# server using the `psql` client. Idempotent — safe to run repeatedly.
#
# This is a thin shell alternative to `npm run db:setup` (which does the same
# thing in pure Node and works on Windows too). Use whichever you prefer.
#
# Usage:
#   bash scripts/setup-db.sh            # create role + database
#   RESET=1 bash scripts/setup-db.sh    # drop + recreate the database
#
# Override any of these via environment variables:
#   DB_NAME (workflow)  DB_USER (workflow)  DB_PASS (workflow)
#   PGHOST (localhost)  PGPORT (5432)       ADMIN_DB (postgres)
#   PGUSER (your OS user) — the superuser used to create the role/database
# ---------------------------------------------------------------------------
set -euo pipefail

DB_NAME="${DB_NAME:-workflow}"
DB_USER="${DB_USER:-workflow}"
DB_PASS="${DB_PASS:-workflow}"
ADMIN_DB="${ADMIN_DB:-postgres}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
# Admin user defaults to your OS user (Homebrew/peer auth). Override with PGUSER.
ADMIN_USER="${PGUSER:-$(whoami)}"

if ! command -v psql >/dev/null 2>&1; then
  echo "✗ 'psql' not found on PATH. Install the PostgreSQL client first." >&2
  echo "    macOS: brew install postgresql@16" >&2
  echo "    Linux: sudo apt-get install postgresql-client" >&2
  exit 1
fi

psql_admin() {
  psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$ADMIN_USER" -d "$ADMIN_DB" "$@"
}

echo "• Creating role '$DB_USER' and database '$DB_NAME' on $PGHOST:$PGPORT (admin: $ADMIN_USER)"

# Role (idempotent)
if [ "$(psql_admin -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")" = "1" ]; then
  echo "  role '$DB_USER' already exists"
else
  psql_admin -c "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASS'"
  echo "  created role '$DB_USER'"
fi

# Optional reset
if [ "${RESET:-0}" = "1" ] && \
   [ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")" = "1" ]; then
  psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
                 WHERE datname='$DB_NAME' AND pid <> pg_backend_pid()" >/dev/null
  psql_admin -c "DROP DATABASE \"$DB_NAME\""
  echo "  dropped database '$DB_NAME' (RESET=1)"
fi

# Database (idempotent)
if [ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")" = "1" ]; then
  echo "  database '$DB_NAME' already exists"
else
  psql_admin -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\""
  echo "  created database '$DB_NAME'"
fi

echo "✓ Database ready. Next: npm run migrate"

#!/usr/bin/env bash
# =====================================================================
# Nightly logical export -- supplementary to Supabase's own automatic
# backups (point-in-time recovery, if enabled on your plan). This is a
# second, independent copy under your own control: a plan-cancellation,
# account-lockout, or Supabase-side incident shouldn't be the only way
# you lose access to your own data.
#
# Requires: pg_dump (from any Postgres 15+ client install), and your
# Supabase project's direct connection string (Project Settings ->
# Database -> Connection string -> URI, NOT the pooler/transaction
# mode string -- pg_dump needs a direct connection).
#
# Usage:
#   export SUPABASE_DB_URL="postgresql://postgres:[password]@[host]:5432/postgres"
#   ./nightly_export.sh /path/to/backup/dir
#
# Suggested cron (2am daily): 0 2 * * * /path/to/nightly_export.sh /backups >> /backups/export.log 2>&1
# =====================================================================
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
DATE=$(date +%Y%m%d_%H%M%S)
OUT_FILE="${BACKUP_DIR}/awt_backup_${DATE}.sql.gz"
RETENTION_DAYS=30

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "ERROR: SUPABASE_DB_URL is not set. See usage in this script's header." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting export -> $OUT_FILE"

# --schema=public: application data only, not Supabase's internal
# auth/storage/realtime schemas (those are Supabase's own responsibility
# and restoring them from an app-level backup would be actively wrong).
# --no-owner/--no-privileges: keeps the dump portable across projects.
pg_dump "$SUPABASE_DB_URL" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --format=plain \
  | gzip > "$OUT_FILE"

SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo "[$(date)] Export complete: $OUT_FILE ($SIZE)"

# Sanity check: a suspiciously small file usually means the connection
# failed silently or RLS blocked the export role from seeing data --
# fail loudly rather than silently keeping a useless backup.
MIN_BYTES=1024
ACTUAL_BYTES=$(stat -f%z "$OUT_FILE" 2>/dev/null || stat -c%s "$OUT_FILE")
if [ "$ACTUAL_BYTES" -lt "$MIN_BYTES" ]; then
  echo "[$(date)] WARNING: backup file is suspiciously small (${ACTUAL_BYTES} bytes). Investigate before trusting this backup." >&2
  exit 2
fi

# Also export Storage bucket contents (blueprint images) -- pg_dump only
# covers the database, not Supabase Storage objects.
if command -v supabase >/dev/null 2>&1; then
  echo "[$(date)] Exporting Storage bucket 'blueprints'..."
  supabase storage cp --recursive "ss:///blueprints" "${BACKUP_DIR}/blueprints_${DATE}/" 2>&1 || \
    echo "[$(date)] WARNING: Storage export failed or supabase CLI not authenticated -- database backup still completed." >&2
else
  echo "[$(date)] NOTE: supabase CLI not found -- skipping Storage bucket export. Install it to back up blueprint images too." >&2
fi

echo "[$(date)] Pruning backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "awt_backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
find "$BACKUP_DIR" -maxdepth 1 -name "blueprints_*" -type d -mtime +${RETENTION_DAYS} -exec rm -rf {} +

echo "[$(date)] Done."

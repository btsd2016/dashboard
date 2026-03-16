#!/bin/bash
RAILWAY_URL="https://tsd-dashboard-production.up.railway.app"
DASHBOARD_PASSWORD="tsd2026"
WATCH_DIR="$HOME/TSD Dashboard/data-drops"
LOG="$HOME/TSD Dashboard/watcher.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

upload_file() {
  local FILE_PATH="$1"
  local FILENAME=$(basename "$FILE_PATH")
  local EXTENSION="${FILENAME##*.}"
  local PARENT_FOLDER=$(basename "$(dirname "$FILE_PATH")")

  # Only process CSV and XLSX files
  local EXT_LOWER=$(echo "$EXTENSION" | tr '[:upper:]' '[:lower:]')
  if [[ "$EXT_LOWER" != "csv" ]] && [[ "$EXT_LOWER" != "xlsx" ]]; then return; fi

  sleep 2
  [ ! -s "$FILE_PATH" ] && return
  [[ "$FILENAME" == *.part ]] || [[ "$FILENAME" == .* ]] && return

  VALID_SOURCES="xero-pl xero-balance lightyear square-items custom"
  echo "$VALID_SOURCES" | grep -qw "$PARENT_FOLDER" && SOURCE="$PARENT_FOLDER" || SOURCE="custom"

  # Set content type based on extension
  if [[ "$EXT_LOWER" == "xlsx" ]]; then
    CONTENT_TYPE="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  else
    CONTENT_TYPE="text/plain"
  fi

  log "New file detected: $FILENAME → source: $SOURCE ($EXT_LOWER)"

  RESPONSE=$(/usr/bin/curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: $CONTENT_TYPE" \
    -H "x-dashboard-password: $DASHBOARD_PASSWORD" \
    -H "x-filename: $FILENAME" \
    --data-binary "@$FILE_PATH" \
    "$RAILWAY_URL/api/data-drop/$SOURCE" \
    --max-time 30)

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | head -n-1)

  if [ "$HTTP_CODE" = "200" ]; then
    log "✅ Uploaded: $FILENAME → $SOURCE"
    /usr/bin/osascript -e "display notification \"$FILENAME uploaded to dashboard\" with title \"TSD Dashboard\" subtitle \"Source: $SOURCE\" sound name \"Glass\""
  else
    log "❌ Failed (HTTP $HTTP_CODE): $FILENAME — $BODY"
    /usr/bin/osascript -e "display notification \"Failed: $FILENAME (HTTP $HTTP_CODE)\" with title \"TSD Dashboard\" sound name \"Basso\""
  fi
}

log "Watcher started — watching $WATCH_DIR"
/opt/homebrew/bin/fswatch -0 --event Created --event MovedTo --recursive --latency 1 "$WATCH_DIR" \
  | while IFS= read -r -d '' FILE_PATH; do upload_file "$FILE_PATH"; done

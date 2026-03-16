#!/bin/bash
# ============================================================
# TSD Dashboard — Data Drop Uploader
# Run via Cowork: watches ~/TSD Dashboard/data-drops/ for new files
# and uploads them to the Railway backend
#
# Cowork setup:
# - Trigger: File created in ~/TSD Dashboard/data-drops/**
# - Action: Run this script with FILE_PATH=$filepath
# ============================================================

RAILWAY_URL="https://tsd-dashboard-production.up.railway.app"
DASHBOARD_PASSWORD="tsd2026"

FILE_PATH="${1:-$FILE_PATH}"

if [ -z "$FILE_PATH" ]; then
  echo "ERROR: No file path provided"
  echo "Usage: ./upload-data-drop.sh /path/to/file.csv"
  exit 1
fi

if [ ! -f "$FILE_PATH" ]; then
  echo "ERROR: File not found: $FILE_PATH"
  exit 1
fi

# Determine source from parent folder name
PARENT_FOLDER=$(basename "$(dirname "$FILE_PATH")")
FILENAME=$(basename "$FILE_PATH")
EXTENSION="${FILENAME##*.}"

echo "================================================"
echo "TSD Dashboard — Data Drop Upload"
echo "File:   $FILENAME"
echo "Source: $PARENT_FOLDER"
echo "================================================"

# Validate source folder name
VALID_SOURCES="xero-pl xero-balance lightyear square-items custom"
if echo "$VALID_SOURCES" | grep -qw "$PARENT_FOLDER"; then
  SOURCE="$PARENT_FOLDER"
  echo "✅ Recognised source: $SOURCE"
else
  SOURCE="custom"
  echo "⚠️  Unrecognised folder '$PARENT_FOLDER' — uploading as 'custom'"
fi

# Only process CSV files
if [ "$EXTENSION" != "csv" ] && [ "$EXTENSION" != "CSV" ]; then
  echo "⚠️  Skipping non-CSV file: $FILENAME"
  exit 0
fi

# Upload to Railway backend
echo "Uploading to backend..."

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: text/plain" \
  -H "x-dashboard-password: $DASHBOARD_PASSWORD" \
  -H "x-filename: $FILENAME" \
  --data-binary "@$FILE_PATH" \
  "$RAILWAY_URL/api/data-drop/$SOURCE")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Upload successful!"
  echo "$BODY"
else
  echo "❌ Upload failed (HTTP $HTTP_CODE)"
  echo "$BODY"
  exit 1
fi

echo "================================================"
echo "Done. Data available at:"
echo "$RAILWAY_URL/api/data-drop/$SOURCE?password=$DASHBOARD_PASSWORD"
echo "================================================"

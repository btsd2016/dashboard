#!/bin/bash
# ============================================================
# TSD Dashboard — One-command Mac Setup
# Run this once: bash install.sh
# Sets up folder structure + background watcher service
# ============================================================

set -e

HOMEDIR="$HOME"
DASHBOARD_DIR="$HOMEDIR/TSD Dashboard"
DROPS_DIR="$DASHBOARD_DIR/data-drops"
PLIST_NAME="com.tsd.dashboard.datadrop"
PLIST_DEST="$HOMEDIR/Library/LaunchAgents/$PLIST_NAME.plist"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo ""
echo "================================================"
echo "  TSD Dashboard — Mac Setup"
echo "================================================"
echo ""

# ── Step 1: Create folder structure ──────────────────────────
echo "📁 Creating folder structure..."
mkdir -p "$DROPS_DIR/xero-pl"
mkdir -p "$DROPS_DIR/xero-balance"
mkdir -p "$DROPS_DIR/lightyear"
mkdir -p "$DROPS_DIR/square-items"
mkdir -p "$DROPS_DIR/custom"
echo "   ✅ ~/TSD Dashboard/data-drops/ created"
echo "      ├── xero-pl/"
echo "      ├── xero-balance/"
echo "      ├── lightyear/"
echo "      ├── square-items/"
echo "      └── custom/"

# ── Step 2: Install Homebrew (if needed) ─────────────────────
echo ""
echo "🍺 Checking Homebrew..."
if ! command -v brew &> /dev/null; then
  echo "   Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "   ✅ Homebrew already installed"
fi

# ── Step 3: Install fswatch ───────────────────────────────────
echo ""
echo "👁  Checking fswatch..."
if ! command -v fswatch &> /dev/null; then
  echo "   Installing fswatch..."
  brew install fswatch
  echo "   ✅ fswatch installed"
else
  echo "   ✅ fswatch already installed"
fi

# ── Step 4: Install watcher script ───────────────────────────
echo ""
echo "📜 Installing watcher script..."
cp "$SCRIPT_DIR/watch-drops.sh" "$DASHBOARD_DIR/watch-drops.sh"
chmod +x "$DASHBOARD_DIR/watch-drops.sh"
echo "   ✅ watch-drops.sh installed to ~/TSD Dashboard/"

# ── Step 5: Install LaunchAgent (background service) ─────────
echo ""
echo "⚙️  Installing background service..."

# Replace HOMEDIR placeholder in plist
sed "s|HOMEDIR|$HOMEDIR|g" "$SCRIPT_DIR/com.tsd.dashboard.datadrop.plist" > "$PLIST_DEST"

# Stop existing service if running
launchctl unload "$PLIST_DEST" 2>/dev/null || true

# Start service
launchctl load "$PLIST_DEST"
echo "   ✅ Background service installed and started"

# ── Step 6: Set Safari/Chrome download folder ─────────────────
echo ""
echo "🌐 Browser download folder setup..."
echo "   To complete setup, change your browser's download folder:"
echo ""
echo "   Safari:  Preferences → General → File download location"
echo "            Change to a convenient location OR use subfolders directly"
echo ""
echo "   Chrome:  Settings → Downloads → Location"
echo "            You can also right-click any download → 'Save As' to pick the folder"
echo ""
echo "   TIP: The quickest workflow is to save exports directly to:"
echo "   ~/TSD Dashboard/data-drops/xero-pl/   (for Xero P&L)"
echo "   ~/TSD Dashboard/data-drops/lightyear/  (for Lightyear)"
echo "   etc."

# ── Done ──────────────────────────────────────────────────────
echo ""
echo "================================================"
echo "  ✅ Setup complete!"
echo "================================================"
echo ""
echo "The watcher is now running in the background."
echo "It will start automatically every time you log in."
echo ""
echo "Test it: save any .csv file into:"
echo "  ~/TSD Dashboard/data-drops/xero-pl/"
echo ""
echo "You'll hear a 'Glass' sound and see a Mac notification"
echo "when the upload succeeds."
echo ""
echo "Check upload history:"
echo "  cat ~/TSD\ Dashboard/watcher.log"
echo ""
echo "Check backend data status:"
echo "  https://tsd-dashboard-production.up.railway.app/api/data-drop?password=tsd2026"
echo ""

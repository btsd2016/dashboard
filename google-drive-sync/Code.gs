// ============================================================
// TSD Dashboard — Google Drive Auto-Sync
// 
// HOW TO SET UP:
// 1. Go to script.google.com → New project
// 2. Paste this entire file, replacing the default code
// 3. Update FOLDER_ID below with your Drive folder ID
// 4. Click Run → setupTrigger (grant permissions when asked)
// 5. Done — any xlsx dropped in the folder syncs automatically
// ============================================================

// ── CONFIG — update these ────────────────────────────────────

const DASHBOARD_URL = 'https://dashboard.thesellerdoor.com.au';
const DASHBOARD_PASSWORD = 'tsd2026';

// Your Google Drive folder ID (from the URL when you open the folder)
// e.g. drive.google.com/drive/folders/THIS_PART_HERE
const FOLDER_ID = 'PASTE_YOUR_FOLDER_ID_HERE';

// How long to wait before re-uploading the same file (milliseconds)
// Default: 2 hours — prevents re-uploading same file if trigger runs again
const DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000;

// ── SOURCE DETECTION ─────────────────────────────────────────
// Maps folder name or filename keywords → API endpoint

function detectSource(filename, folderName) {
  const name = (filename + ' ' + folderName).toLowerCase();
  
  if (name.includes('profit') || name.includes('p&l') || name.includes('pl ') || 
      name.includes(' pl_') || name.includes('income')) {
    return 'xero-pl';
  }
  if (name.includes('balance')) {
    return 'xero-balance';
  }
  if (name.includes('lightyear') || name.includes('purchase')) {
    return 'lightyear';
  }
  if (name.includes('square') || name.includes('item')) {
    return 'square-items';
  }
  // Default: treat as xero-pl (most common upload)
  return 'xero-pl';
}

// ── UPLOAD SINGLE FILE ───────────────────────────────────────

function uploadFile(file, source) {
  const filename = file.getName();
  const bytes = file.getBlob().getBytes();
  
  console.log(`[TSD Sync] Uploading ${filename} as ${source}...`);
  
  const url = `${DASHBOARD_URL}/api/data-drop/${source}`;
  
  const options = {
    method: 'POST',
    headers: {
      'x-dashboard-password': DASHBOARD_PASSWORD,
      'x-filename': filename,
      'Content-Type': 'application/octet-stream',
    },
    payload: bytes,
    muteHttpExceptions: true,
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const body = response.getContentText();
  
  if (code === 200) {
    let result;
    try { result = JSON.parse(body); } catch(e) { result = { raw: body }; }
    console.log(`[TSD Sync] ✅ ${filename} uploaded successfully`, JSON.stringify(result.summary || {}));
    return { success: true, filename, source, summary: result.summary };
  } else {
    console.error(`[TSD Sync] ❌ Failed ${filename}: HTTP ${code} — ${body}`);
    return { success: false, filename, source, error: `HTTP ${code}` };
  }
}

// ── TRIGGER REFRESH ──────────────────────────────────────────

function triggerDashboardRefresh() {
  try {
    const options = {
      method: 'POST',
      headers: { 'x-dashboard-password': DASHBOARD_PASSWORD },
      muteHttpExceptions: true,
    };
    UrlFetchApp.fetch(`${DASHBOARD_URL}/api/refresh`, options);
    console.log('[TSD Sync] Dashboard refresh triggered');
  } catch(e) {
    console.log('[TSD Sync] Could not trigger refresh:', e.message);
  }
}

// ── MAIN SYNC FUNCTION ───────────────────────────────────────
// Checks folder for new/modified xlsx files and uploads them

function syncDriveFolder() {
  if (FOLDER_ID === 'PASTE_YOUR_FOLDER_ID_HERE') {
    console.error('[TSD Sync] ❌ Please set FOLDER_ID in the script config!');
    return;
  }
  
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const props = PropertiesService.getScriptProperties();
  
  // Get all xlsx files in folder (and subfolders)
  const results = [];
  
  function processFolder(f, folderName) {
    // Process xlsx files
    const files = f.getFilesByType(MimeType.MICROSOFT_EXCEL);
    while (files.hasNext()) {
      const file = files.next();
      const fileId = file.getId();
      const filename = file.getName();
      const modified = file.getLastUpdated().getTime();
      
      // Check if we've already uploaded this version
      const lastUpload = parseInt(props.getProperty('uploaded_' + fileId) || '0');
      if (modified <= lastUpload && (Date.now() - lastUpload) < DEDUP_WINDOW_MS) {
        console.log(`[TSD Sync] Skipping ${filename} — already uploaded`);
        continue;
      }
      
      const source = detectSource(filename, folderName);
      const result = uploadFile(file, source);
      
      if (result.success) {
        props.setProperty('uploaded_' + fileId, Date.now().toString());
      }
      results.push(result);
    }
    
    // Also check Google Sheets exports (downloaded as xlsx)
    const sheets = f.getFilesByType(MimeType.GOOGLE_SHEETS);
    // (skip native Sheets — user should export to xlsx manually)
    
    // Recurse into subfolders
    const subfolders = f.getFolders();
    while (subfolders.hasNext()) {
      const sub = subfolders.next();
      processFolder(sub, sub.getName());
    }
  }
  
  processFolder(folder, folder.getName());
  
  if (results.length > 0) {
    console.log(`[TSD Sync] Processed ${results.length} file(s):`, JSON.stringify(results));
    // Trigger a dashboard data refresh after uploads
    triggerDashboardRefresh();
  } else {
    console.log('[TSD Sync] No new files to upload');
  }
  
  return results;
}

// ── MANUAL SYNC — run this to sync right now ─────────────────

function manualSync() {
  console.log('[TSD Sync] Manual sync started...');
  const results = syncDriveFolder();
  console.log('[TSD Sync] Manual sync complete');
  return results;
}

// ── SETUP TRIGGER — run once to configure auto-sync ──────────
// Checks every 15 minutes for new files

function setupTrigger() {
  // Remove any existing triggers first
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncDriveFolder') {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // Create new 15-minute trigger
  ScriptApp.newTrigger('syncDriveFolder')
    .timeBased()
    .everyMinutes(15)
    .create();
  
  console.log('[TSD Sync] ✅ Auto-sync trigger set — checks every 15 minutes');
  console.log('[TSD Sync] Drop any Xero xlsx into your Drive folder to sync');
  console.log(`[TSD Sync] Folder: https://drive.google.com/drive/folders/${FOLDER_ID}`);
}

// ── REMOVE TRIGGER ───────────────────────────────────────────

function removeTrigger() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncDriveFolder') {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  console.log(`[TSD Sync] Removed ${count} trigger(s)`);
}

// ── STATUS CHECK ─────────────────────────────────────────────

function checkStatus() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncDriveFolder');
  
  console.log('=== TSD Drive Sync Status ===');
  console.log(`Dashboard: ${DASHBOARD_URL}`);
  console.log(`Folder ID: ${FOLDER_ID}`);
  console.log(`Active triggers: ${triggers.length}`);
  
  // Test dashboard connection
  try {
    const res = UrlFetchApp.fetch(
      `${DASHBOARD_URL}/health`,
      { muteHttpExceptions: true }
    );
    const health = JSON.parse(res.getContentText());
    console.log(`Dashboard status: ${health.status}`);
    console.log(`Last refresh: ${health.lastRefresh}`);
    console.log(`Has Square data: ${health.hasData?.sales}`);
    console.log(`Has Labour data: ${health.hasData?.labour}`);
  } catch(e) {
    console.log(`Dashboard connection: FAILED — ${e.message}`);
  }
}

// ── FORCE RESYNC ALL FILES ────────────────────────────────────
// Run this once to clear the dedup cache and re-upload all files
// Needed when: monthly index needs rebuilding, or after a backend reset

function forceResyncAll() {
  console.log('[TSD Sync] Clearing dedup cache and re-uploading all files...');

  // Clear all upload timestamps so all files are treated as new
  const props = PropertiesService.getScriptProperties();
  const allKeys = props.getKeys();
  const uploadKeys = allKeys.filter(k => k.startsWith('uploaded_'));
  uploadKeys.forEach(k => props.deleteProperty(k));
  console.log(`[TSD Sync] Cleared ${uploadKeys.length} cached upload timestamps`);

  // Now run sync — all files will be treated as new
  const results = syncDriveFolder();
  console.log(`[TSD Sync] Force resync complete — processed ${(results||[]).length} files`);
}

# Google Drive → TSD Dashboard Auto-Sync

## What this does
Any Xero xlsx you drop into a Google Drive folder automatically uploads
to the dashboard within 15 minutes. No terminal, no curl, no Cowork needed.

---

## Setup (one-time, ~5 minutes)

### Step 1 — Create the Drive folder
1. Go to Google Drive
2. Create a new folder: **TSD Dashboard / Xero Uploads**
3. Open the folder and copy the ID from the URL:
   `drive.google.com/drive/folders/` **← THIS PART →**
4. Save that ID — you'll need it in Step 3

### Step 2 — Create the Apps Script project
1. Go to **script.google.com**
2. Click **New project**
3. Name it: `TSD Dashboard Sync`
4. Delete the default `myFunction()` code
5. Paste the entire contents of `Code.gs` (in this folder)

### Step 3 — Set your Folder ID
In the script, find this line near the top:
```
const FOLDER_ID = 'PASTE_YOUR_FOLDER_ID_HERE';
```
Replace `PASTE_YOUR_FOLDER_ID_HERE` with the folder ID from Step 1.

### Step 4 — Run setup
1. In the script editor, select function **`setupTrigger`** from the dropdown
2. Click **Run**
3. When prompted, click **Review permissions** → **Allow**
   (It needs permission to access Drive and make web requests)
4. You'll see "Auto-sync trigger set — checks every 15 minutes" in the logs

### Step 5 — Test it
1. Select function **`checkStatus`** → click Run
2. You should see the dashboard is connected and data status
3. Select **`manualSync`** → click Run to force a sync right now

---

## How to use day-to-day

### Xero P&L export
1. In Xero → Reports → Profit and Loss
2. Set date range (e.g. last month)
3. Add Tracking: select Location
4. Export → **Download as Excel (.xlsx)**
5. Drop the file into your **TSD Dashboard / Xero Uploads** folder in Drive
6. Dashboard updates within 15 minutes (or run `manualSync` for immediate)

### The script auto-detects what type of file it is:
| Filename contains | Detected as |
|---|---|
| "Profit", "P&L", "Income" | Xero P&L |
| "Balance" | Xero Balance Sheet |
| "Lightyear", "Purchase" | Lightyear |
| "Square", "Item" | Square items |
| Anything else | Xero P&L (default) |

---

## Sharing the folder
You can share the Drive folder with Andy and Tom so they can drop files too.
The script runs under your Google account regardless of who adds the file.

---

## Troubleshooting

**"Please set FOLDER_ID"** — You haven't updated the FOLDER_ID constant in the script.

**"Dashboard connection: FAILED"** — Railway may be sleeping. Visit
dashboard.thesellerdoor.com.au to wake it, then try again.

**File uploaded but GP% still shows —** — Run `manualSync`, then wait 30 seconds
and refresh the dashboard. The data is there but the cache may not have refreshed.

**Want to sync immediately?** — Run `manualSync` function in the script editor.

---

## Disabling auto-sync
Run `removeTrigger` in the script editor to stop automatic checks.

# TSD Dashboard — Data Drops

## Folder Structure

Create this folder structure on your Mac:

```
~/TSD Dashboard/
  └── data-drops/
      ├── xero-pl/          ← Xero Profit & Loss CSV exports
      ├── xero-balance/     ← Xero Balance Sheet CSV exports  
      ├── lightyear/        ← Lightyear purchase/invoice reports
      ├── square-items/     ← Square item detail CSV exports
      └── custom/           ← Any other CSV for analysis
```

## How to Use

### Xero P&L (monthly)
1. In Xero → Reports → Profit and Loss
2. Set date range to last month
3. Add Tracking: select Location (shows Brighton/Henley/Marino split)
4. Click Export → CSV
5. Save into `~/TSD Dashboard/data-drops/xero-pl/`
6. Repeat for "The Seller Door - Nest" org → same folder

### Lightyear
1. In Lightyear → Reports → Purchase Summary
2. Set date range
3. Export as CSV
4. Save into `~/TSD Dashboard/data-drops/lightyear/`

### Square Items (if API isn't sufficient)
1. In Square Dashboard → Reports → Item Sales
2. Export as CSV
3. Save into `~/TSD Dashboard/data-drops/square-items/`

## Cowork Automation Setup

Add a Cowork workflow with:
- **Trigger:** New file created in `~/TSD Dashboard/data-drops/**`
- **Action:** Run shell script
- **Script:** `~/TSD Dashboard/upload-data-drop.sh "$filepath"`

The script automatically:
- Reads the subfolder name to determine the data source
- Uploads the CSV to the Railway backend
- Parses and stores the data
- Makes it available to the dashboard immediately

## API Endpoints

Check what's been uploaded:
```
https://tsd-dashboard-production.up.railway.app/api/data-drop?password=tsd2026
```

See latest Xero P&L data:
```
https://tsd-dashboard-production.up.railway.app/api/data-drop/xero-pl?password=tsd2026
```

Manually upload a file (without Cowork):
```bash
curl -X POST \
  -H "Content-Type: text/plain" \
  -H "x-dashboard-password: tsd2026" \
  -H "x-filename: march-pl.csv" \
  --data-binary "@path/to/file.csv" \
  "https://tsd-dashboard-production.up.railway.app/api/data-drop/xero-pl"
```

## Adding New Data Sources

To add a new source (e.g. weather data, events calendar):
1. Create a new subfolder: `~/TSD Dashboard/data-drops/my-source/`
2. Drop CSVs in there — they'll be uploaded as `custom` type automatically
3. Tell us what columns the CSV has and we'll write a dedicated parser

## Data Freshness

The dashboard shows when each source was last updated.
Recommended upload schedule:
- **Xero P&L:** Monthly (1st of each month, for prior month)
- **Lightyear:** Weekly or monthly
- **Square items:** On demand (API handles live data)

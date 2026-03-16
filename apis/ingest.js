// ============================================================
// Generic Data Ingestion — Manual file drops
// Supports: xero-pl (xlsx/csv), lightyear, square-items, custom
// Files dropped via folder watcher → POST to /api/data-drop/:source
// ============================================================

const fs = require('fs');
const path = require('path');

// DATA_DIR: use Railway volume mount path if set, otherwise local ./data
// In Railway: add a Volume mounted at /data, then set DATA_DIR=/data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
console.log('[Ingest] Data directory:', DATA_DIR);

function storePath(source) {
  return path.join(DATA_DIR, `${source}.json`);
}

function loadStored(source) {
  try {
    if (fs.existsSync(storePath(source))) {
      return JSON.parse(fs.readFileSync(storePath(source), 'utf8'));
    }
  } catch (e) {}
  return null;
}

function saveStored(source, data) {
  fs.writeFileSync(storePath(source), JSON.stringify(data, null, 2));
}

// ── XLSX Parser (uses SheetJS) ────────────────────────────────

function parseXeroPlXlsx(buffer, filename) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const result = {
    source: 'xero-pl',
    filename,
    uploadedAt: new Date().toISOString(),
    orgName: null,
    period: null,
    venues: {},
    raw: {},
  };

  // Row 0: "Profit and Loss"
  // Row 1: Org name
  // Row 2: Period e.g. "For the month ended 28 February 2026"
  // Row 4: Headers — Account | Brighton | Henley | Marino | Total
  result.orgName = rows[1]?.[0] || '';
  result.period = rows[2]?.[0] || '';

  // Find header row (contains "Account" and venue names)
  let headerRow = -1;
  let venueColumns = {}; // venue name → column index
  let isSingleOrg = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[0] === 'Account') {
      headerRow = i;
      const dataCols = row.slice(1).filter(v => v !== null && v !== undefined && v !== '');

      if (dataCols.length === 1 || (dataCols.length === 1 && String(dataCols[0]).includes('Total'))) {
        // Single org — no tracking categories (e.g. Nest Kiosk)
        isSingleOrg = true;
        venueColumns['NES'] = 1; // use column 1 (only data column)
      } else {
        // Multi-venue — skip last (Total) column
        for (let c = 1; c < row.length - 1; c++) {
          if (row[c]) venueColumns[row[c]] = c;
        }
      }
      break;
    }
  }

  if (headerRow === -1) {
    throw new Error('Could not find header row in Xero P&L xlsx');
  }

  // Map venue column names to our venue codes
  // For single-org Nest files, venueColumns key is already 'NES'
  const VENUE_CODE_MAP = {
    'Brighton': 'TSD',
    'Henley': 'TLC',
    'Marino': 'LNM',
    'NES': 'NES',
  };

  // Initialise venue buckets
  Object.entries(venueColumns).forEach(([venueName, colIdx]) => {
    const code = VENUE_CODE_MAP[venueName] || venueName;
    result.venues[code] = {
      venueName,
      revenue: 0,
      cogs: 0,
      grossProfit: 0,
      gpPct: 0,
      wages: 0,
      super: 0,
      managementWages: 0,
      managementSuper: 0,
      labourExVendorMgmt: 0,
      labourPct: 0,
    };
  });

  // Parse data rows
  let currentSection = '';

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const label = String(row[0]).trim();

    // Section headers (no numeric values)
    if (['Trading Income', 'Cost of Sales', 'Other Income', 'Operating Expenses'].includes(label)) {
      currentSection = label;
      continue;
    }

    // Skip formula/total rows
    if (label.startsWith('Total') || label === 'Gross Profit' || label === 'Net Profit') {
      // But capture Gross Profit for verification
      if (label === 'Gross Profit') {
        Object.entries(venueColumns).forEach(([venueName, colIdx]) => {
          const code = VENUE_CODE_MAP[venueName] || venueName;
          const val = typeof row[colIdx] === 'number' ? row[colIdx] : 0;
          result.venues[code].grossProfitReported = val;
        });
      }
      continue;
    }

    // Process data rows
    Object.entries(venueColumns).forEach(([venueName, colIdx]) => {
      const code = VENUE_CODE_MAP[venueName] || venueName;
      const val = typeof row[colIdx] === 'number' ? row[colIdx] : 0;
      const v = result.venues[code];

      if (currentSection === 'Trading Income') {
        v.revenue += val;
        result.raw[label] = result.raw[label] || {};
        result.raw[label][code] = val;
      }

      if (currentSection === 'Cost of Sales') {
        v.cogs += val;
      }

      if (currentSection === 'Operating Expenses') {
        const isManagementWages = label === 'Wages - Management';
        const isManagementSuper = label === 'Superannuation - Management';
        const isWages = label === 'Wages and Salaries';
        const isSuper = label === 'Superannuation' && !isManagementSuper;

        if (isManagementWages) v.managementWages += val;
        else if (isManagementSuper) v.managementSuper += val;
        else if (isWages) v.wages += val;
        else if (isSuper) v.super += val;
      }
    });
  }

  // Calculate final figures
  Object.values(result.venues).forEach(v => {
    v.grossProfit = v.revenue - v.cogs;
    v.gpPct = v.revenue > 0 ? parseFloat((v.grossProfit / v.revenue * 100).toFixed(1)) : 0;
    v.labourExVendorMgmt = v.wages + v.super; // excludes Anna Lisa & Andrew
    v.labourPct = v.revenue > 0 ? parseFloat((v.labourExVendorMgmt / v.revenue * 100).toFixed(1)) : 0;
  });

  return result;
}

// ── CSV fallback parser ───────────────────────────────────────

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += line[i]; }
  }
  result.push(current.trim());
  return result;
}

function cleanAmount(str) {
  if (!str && str !== 0) return 0;
  const cleaned = String(str).replace(/[$,\s]/g, '').replace(/\((\d)/g, '-$1').replace(/\)/g, '');
  return parseFloat(cleaned) || 0;
}

// ── Lightyear parser ──────────────────────────────────────────

function parseLightyear(buffer, filename) {
  const text = buffer.toString('utf8');
  const lines = text.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(l => {
    const vals = parseCSVLine(l);
    const row = {};
    headers.forEach((h, i) => row[h] = vals[i] || '');
    return row;
  });

  const result = {
    source: 'lightyear',
    filename,
    uploadedAt: new Date().toISOString(),
    bySupplier: {},
    byCategory: {},
    total: 0,
  };

  rows.forEach(row => {
    const supplier = row['Supplier'] || row['Vendor'] || row['Contact'] || 'Unknown';
    const category = row['Category'] || row['Account'] || 'Uncategorised';
    const amount = cleanAmount(row['Total'] || row['Amount'] || row['Net'] || '0');
    if (!result.bySupplier[supplier]) result.bySupplier[supplier] = 0;
    result.bySupplier[supplier] += amount;
    if (!result.byCategory[category]) result.byCategory[category] = 0;
    result.byCategory[category] += amount;
    result.total += amount;
  });

  result.topSuppliers = Object.entries(result.bySupplier)
    .sort(([,a],[,b]) => b - a).slice(0, 20)
    .map(([name, amount]) => ({ name, amount }));

  return result;
}

// ── Custom / generic ──────────────────────────────────────────

function parseCustom(buffer, filename) {
  const text = buffer.toString('utf8');
  const lines = text.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(l => {
    const vals = parseCSVLine(l);
    const row = {};
    headers.forEach((h, i) => row[h] = vals[i] || '');
    return row;
  });
  return {
    source: 'custom',
    filename,
    uploadedAt: new Date().toISOString(),
    rowCount: rows.length,
    columns: headers,
    rows: rows.slice(0, 1000),
  };
}


// ── Period key extraction ─────────────────────────────────────
// Extracts YYYY-MM key from Xero period strings or filenames

function extractPeriodKey(periodStr, filename) {
  // Try period string first: "For the month ended 28 February 2026"
  const MONTHS = {
    january:'01',february:'02',march:'03',april:'04',
    may:'05',june:'06',july:'07',august:'08',
    september:'09',october:'10',november:'11',december:'12'
  };

  if (periodStr) {
    const lower = periodStr.toLowerCase();
    for (const [name, num] of Object.entries(MONTHS)) {
      if (lower.includes(name)) {
        const yearMatch = lower.match(/(20\d\d)/);
        if (yearMatch) return `${yearMatch[1]}-${num}`;
      }
    }
  }

  // Fall back to filename: TSD-Group-PL-Feb2026.xlsx
  if (filename) {
    const lower = filename.toLowerCase();
    for (const [name, num] of Object.entries(MONTHS)) {
      if (lower.includes(name.slice(0,3))) {
        const yearMatch = lower.match(/(20\d\d)/);
        if (yearMatch) return `${yearMatch[1]}-${num}`;
      }
    }
  }

  return null;
}

// ── Main ingest function ──────────────────────────────────────

function ingest(source, fileBuffer, filename) {
  console.log(`[Ingest] Processing ${source} / ${filename} (${fileBuffer.length} bytes)`);

  const ext = filename.split('.').pop().toLowerCase();
  let parsed;

  if (source === 'xero-pl' || source === 'xero-balance') {
    if (ext === 'xlsx') {
      parsed = parseXeroPlXlsx(fileBuffer, filename);
    } else {
      throw new Error('Xero exports must be .xlsx format');
    }
  } else if (source === 'lightyear') {
    parsed = parseLightyear(fileBuffer, filename);
  } else {
    parsed = parseCustom(fileBuffer, filename);
  }

  // Store with history — keep ALL monthly files by period key
  const existing = loadStored(source) || { history: [], byMonth: {} };
  existing.latest = parsed;

  // Index by month if this is a P&L with a period
  if (parsed.period && parsed.venues) {
    // Extract YYYY-MM key from period string e.g. "For the month ended 28 February 2026"
    const periodKey = extractPeriodKey(parsed.period, filename);
    if (periodKey) {
      if (!existing.byMonth) existing.byMonth = {};
      if (existing.byMonth[periodKey]) {
        // Merge venues from both orgs into the same month slot
        existing.byMonth[periodKey].venues = Object.assign(
          {},
          existing.byMonth[periodKey].venues,
          parsed.venues
        );
      } else {
        existing.byMonth[periodKey] = parsed;
      }
    }
  }

  // Store parsed venues in history so we can rebuild byMonth later
  const histEntry = { 
    filename, 
    uploadedAt: parsed.uploadedAt, 
    period: parsed.period,
    periodKey: parsed.period ? extractPeriodKey(parsed.period, filename) : extractPeriodKey(null, filename),
    venues: parsed.venues || null,
    orgName: parsed.orgName || null,
  };
  existing.history = [histEntry, ...(existing.history || [])].slice(0, 50);
  existing.lastUpdated = parsed.uploadedAt;
  saveStored(source, existing);

  // Log summary
  if (parsed.venues) {
    Object.entries(parsed.venues).forEach(([code, v]) => {
      console.log(`[Ingest]   ${code}: Revenue $${v.revenue?.toFixed(0)}, GP ${v.gpPct}%, Labour ${v.labourPct}%`);
    });
  }

  console.log(`[Ingest] ✅ Stored ${source} — ${filename}`);
  return parsed;
}

function getStored(source) { return loadStored(source); }

function getAllSources() {
  const sources = {};
  ['xero-pl', 'xero-balance', 'lightyear', 'square-items', 'custom'].forEach(source => {
    const stored = loadStored(source);
    sources[source] = stored
      ? { hasData: true, lastUpdated: stored.lastUpdated, lastFile: stored.history?.[0]?.filename }
      : { hasData: false };
  });
  return sources;
}

function getMonthlyHistory(source) {
  const stored = loadStored(source);
  if (!stored) return {};

  // If byMonth exists and has entries, return it
  if (stored.byMonth && Object.keys(stored.byMonth).length > 0) {
    return stored.byMonth;
  }

  // Rebuild byMonth from history entries (for files uploaded before byMonth was added)
  // Each history entry may have venues stored on it
  const rebuilt = {};
  (stored.history || []).forEach(entry => {
    if (!entry.venues) return;
    const key = entry.periodKey || extractPeriodKey(entry.period, entry.filename);
    if (!key) return;

    if (!rebuilt[key]) {
      rebuilt[key] = { venues: {}, orgName: entry.orgName, period: entry.period };
    }
    // Merge venues from this entry (two files may share a period key — different orgs)
    Object.assign(rebuilt[key].venues, entry.venues);
  });

  // Save rebuilt index back to disk
  if (Object.keys(rebuilt).length > 0) {
    stored.byMonth = rebuilt;
    saveStored(source, stored);
    console.log('[Ingest] Rebuilt byMonth index from history:', Object.keys(rebuilt));
  }

  return rebuilt;
}

module.exports = { ingest, getStored, getAllSources, getMonthlyHistory };

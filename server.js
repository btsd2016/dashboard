// ============================================================
// TSD Group Dashboard — Backend Server
// Node.js + Express, deployed on Railway
// Refresh schedule: 6am / 12pm / 6pm / 12am (Adelaide time)
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const deputy = require('./apis/deputy');
const square = require('./apis/square');
const xero = require('./apis/xero');
const ingest = require('./apis/ingest');
const { getMonthlyHistory } = ingest;
const { setupAuth, requireLogin } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.raw({ limit: "10mb", type: ["text/plain", "application/octet-stream", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] }));

// ── Auth setup (must be before routes) ───────────────────────
setupAuth(app);

// ── In-memory data cache ──────────────────────────────────────

let cache = {
  lastRefresh: null,
  refreshing: false,
  data: {
    labour: null,
    sales: null,
    xero: null,
    aiInsights: null,
    aiInsightsDate: null,
  },
  locationMap: {},  // Square location IDs discovered on first run
  deputyLocations: [], // Deputy locations discovered on first run
};

// ── Public Status Endpoint ─────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    lastRefresh: cache.lastRefresh,
    refreshing: cache.refreshing,
    timestamp: new Date().toISOString(),
    cached: {
      labour: !!cache.data.labour,
      sales: !!cache.data.sales,
      xero: !!cache.data.xero,
      insights: !!cache.data.aiInsights
    }
  });
});

// ── Date helpers ──────────────────────────────────────────────

function getDateRange(period = 'thisWeek') {
  // All dates in Adelaide time (ACST/ACDT)
  const now = new Date();
  const adelaideOffset = 9.5 * 60; // UTC+9:30
  const adelaideNow = new Date(now.getTime() + (adelaideOffset * 60000));

  const today = adelaideNow.toISOString().split('T')[0];

  // Get start of current week (Monday)
  const dayOfWeek = adelaideNow.getDay(); // 0=Sun, 1=Mon...
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(adelaideNow);
  monday.setDate(adelaideNow.getDate() - daysFromMonday);
  const weekStart = monday.toISOString().split('T')[0];

  // Last week
  const lastMonday = new Date(monday);
  lastMonday.setDate(monday.getDate() - 7);
  const lastSunday = new Date(monday);
  lastSunday.setDate(monday.getDate() - 1);

  // This month
  const monthStart = `${adelaideNow.getFullYear()}-${String(adelaideNow.getMonth() + 1).padStart(2, '0')}-01`;

  // Last month
  const lastMonth = new Date(adelaideNow);
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const lastMonthStart = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`;
  const lastMonthEnd = new Date(adelaideNow.getFullYear(), adelaideNow.getMonth(), 0);
  const lastMonthEndStr = lastMonthEnd.toISOString().split('T')[0];

  const ranges = {
    thisWeek: { start: weekStart, end: today },
    lastWeek: { start: lastMonday.toISOString().split('T')[0], end: lastSunday.toISOString().split('T')[0] },
    thisMonth: { start: monthStart, end: today },
    lastMonth: { start: lastMonthStart, end: lastMonthEndStr },
  };

  return ranges[period] || ranges.thisWeek;
}

// ── Data refresh ──────────────────────────────────────────────

async function refreshData() {
  if (cache.refreshing) {
    console.log('[Server] Refresh already in progress, skipping');
    return;
  }

  cache.refreshing = true;
  console.log(`\n[Server] ========= DATA REFRESH STARTED ${new Date().toISOString()} =========`);

  const range = getDateRange('thisWeek');
  const { start, end } = range;

  try {
    // 1. Deputy — Labour data
    // Fetch this week AND last week — this week may have unapproved timesheets
    // but last week should be fully approved (processed Monday morning)
    console.log('[Server] Fetching Deputy labour...');
    try {
      const lastWeekRange = getDateRange('lastWeek');
      const [thisWeekLabour, lastWeekLabour] = await Promise.all([
        deputy.getLabourData(start, end),
        deputy.getLabourData(lastWeekRange.start, lastWeekRange.end),
      ]);
      cache.data.labour = thisWeekLabour;
      cache.data.labourLastWeek = lastWeekLabour;
      console.log(`[Deputy] This week: ${thisWeekLabour.timesheets} timesheets | Last week: ${lastWeekLabour.timesheets} timesheets`);
    } catch (e) {
      console.error('[Server] Deputy failed:', e.message);
    }

    // 2. Square — Sales data (discover locations on first run)
    console.log('[Server] Fetching Square sales...');
    try {
      if (Object.keys(square.LOCATION_MAP).length === 0) {
        const { locationMap } = await square.discoverLocations();
        cache.locationMap = locationMap;
      }
      cache.data.sales = await square.getSalesData(start, end);
    } catch (e) {
      console.error('[Server] Square failed:', e.message);
    }

    // 3. Xero — P&L (monthly, so use current month)
    console.log('[Server] Fetching Xero P&L...');
    try {
      const monthRange = getDateRange('thisMonth');
      cache.data.xero = await xero.getXeroData(monthRange.start, monthRange.end);
    } catch (e) {
      console.error('[Server] Xero failed:', e.message);
      // Xero needs OAuth — provide auth URL
      if (e.message.includes('not authorised')) {
        cache.data.xero = { authRequired: true, authUrl: xero.getAuthUrl() };
      }
    }

    cache.lastRefresh = new Date().toISOString();
    console.log(`[Server] ========= REFRESH COMPLETE ${cache.lastRefresh} =========\n`);

  } catch (e) {
    console.error('[Server] Refresh error:', e);
  } finally {
    cache.refreshing = false;
  }
}

// ── Scheduled refresh (Adelaide time) ────────────────────────
// Cron uses server UTC — Adelaide is UTC+9:30 (UTC+10:30 daylight saving)
// 6am Adelaide  ≈ 20:30 UTC (prev day) / 21:30 UTC (DST)
// 12pm Adelaide ≈ 02:30 UTC / 03:30 UTC
// 6pm Adelaide  ≈ 08:30 UTC / 09:30 UTC
// 12am Adelaide ≈ 14:30 UTC / 15:30 UTC

cron.schedule('30 20 * * *', () => { console.log('[Cron] 6am Adelaide refresh'); refreshData(); });
cron.schedule('30 2 * * *',  () => { console.log('[Cron] 12pm Adelaide refresh'); refreshData(); });
cron.schedule('30 8 * * *',  () => { console.log('[Cron] 6pm Adelaide refresh'); refreshData(); generateAiInsights(); });
cron.schedule('30 14 * * *', () => { console.log('[Cron] 12am Adelaide refresh'); refreshData(); });

// ── AI Insights (6pm daily) ───────────────────────────────────

async function generateAiInsights() {
  if (!process.env.ANTHROPIC_API_KEY) return;

  // Only generate once per day
  const today = new Date().toISOString().split('T')[0];
  if (cache.data.aiInsightsDate === today) return;

  console.log('[Server] Generating AI insights...');

  try {
    const summary = buildDataSummary();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You are a hospitality operations analyst for The Seller Door Group, 
          a multi-venue hospitality business in Adelaide, Australia. 
          Analyse the provided trading data and provide exactly 3 concise, 
          actionable insights for the directors. 
          Focus on: labour%, GP%, sales trends, venue comparisons.
          Venues: Nest Kiosk (NES), The Seller Door (TSD), The Local Canteen (TLC), Little Nest at Marino (LNM).
          Labour benchmarks: TSD WD 40% WE 35%, NES WD 32% WE 25%, TLC WD 35% WE 30%, LNM WD 45% WE 40%.
          Keep each insight to 1-2 sentences. Be direct and specific.
          Return JSON: { "insights": ["insight 1", "insight 2", "insight 3"] }`,
        messages: [{
          role: 'user',
          content: `Here is today's trading summary:\n\n${JSON.stringify(summary, null, 2)}\n\nProvide 3 key insights.`,
        }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    cache.data.aiInsights = parsed.insights || [];
    cache.data.aiInsightsDate = today;
    console.log('[Server] ✅ AI insights generated');

  } catch (e) {
    console.error('[Server] AI insights failed:', e.message);
  }
}

function buildDataSummary() {
  const s = cache.data.sales || {};
  const l = cache.data.labour || {};
  const x = cache.data.xero || {};

  return {
    period: getDateRange('thisWeek'),
    sales: Object.fromEntries(
      Object.entries(s).map(([code, data]) => [code, {
        net: data.totalNet,
        transactions: data.transactionCount,
        avgTx: data.avgTransaction,
      }])
    ),
    labour: {
      totalHours: l.totalActualHours,
      totalCost: l.totalWageCost,
    },
    xero: {
      NES_gp_pct: x.NES?.gpPct,
      TSD_group_gp_pct: x.TSD_GROUP?.gpPct,
    },
  };
}

// ── Routes ────────────────────────────────────────────────────

// Auth check middleware
function requireAuth(req, res, next) {
  const pwd = req.headers['x-dashboard-password'] || req.query.password;
  const validPwd = process.env.DASHBOARD_PASSWORD || 'tsd2026';
  if (pwd === validPwd) return next();
  res.status(401).json({ error: 'Unauthorised' });
}

// Health check (no auth)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    lastRefresh: cache.lastRefresh,
    refreshing: cache.refreshing,
    hasData: {
      labour: !!cache.data.labour,
      sales: !!cache.data.sales,
      xero: !!cache.data.xero,
    },
  });
});

// Xero OAuth callback (no auth — this is the redirect from Xero)
app.get('/xero/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(`<h1>Xero auth error: ${error}</h1>`);
  }

  if (code) {
    try {
      const tokens = await xero.exchangeCodeForTokens(code);
      res.send(`
        <h1>✅ Xero Connected</h1>
        <p>Connected organisations:</p>
        <ul>${tokens.tenants?.map(t => `<li>${t.tenantName}</li>`).join('') || ''}</ul>
        <p>You can close this window.</p>
      `);
    } catch (e) {
      res.send(`<h1>❌ Error: ${e.message}</h1>`);
    }
  }
});

// Xero auth URL (for setup)
app.get('/xero/auth', (req, res) => {
  const authUrl = xero.getAuthUrl();
  res.redirect(authUrl);
});

// Main data endpoint — returns everything for dashboard
// Optional ?start=YYYY-MM-DD&end=YYYY-MM-DD to override period (triggers live fetch)
app.get('/api/data', requireAuth, async (req, res) => {
  const xeroMonthly = getMonthlyHistory('xero-pl');

  // Default: return cached data immediately (fast)
  let sales = cache.data.sales;
  let labour = cache.data.labour;
  let period = getDateRange('thisWeek');

  // Only re-fetch if explicitly requesting a different date range
  if (req.query.start && req.query.end) {
    const s = req.query.start;
    const e = req.query.end;
    period = { start: s, end: e };

    const cached = getDateRange('thisWeek');
    const isThisWeek = (s === cached.start && e === cached.end);

    if (!isThisWeek) {
      try {
        const [sq, dep] = await Promise.all([
          square.getSalesData(s, e),
          deputy.getLabourData(s, e),
        ]);
        sales = sq;
        labour = dep;
      } catch(err) {
        console.error('[Server] Custom range fetch error:', err.message);
        // Fall back to cached data silently
      }
    }
  }

  res.json({
    period,
    lastRefresh: cache.lastRefresh,
    refreshing: cache.refreshing,
    labour,
    labourLastWeek: cache.data.labourLastWeek,
    sales,
    salesLastWeek: cache.data.salesLastWeek,
    xero: cache.data.xero,
    xeroMonthly,
    aiInsights: cache.data.aiInsights,
    aiInsightsDate: cache.data.aiInsightsDate,
    locationMap: cache.locationMap,
  });
});

// ── Convenience Routes ──────────────────────────────────────────
// Alias /api/labour → /api/data
app.get('/api/labour', requireAuth, async (req, res) => {
  try {
    res.json({
      period: getDateRange('thisWeek'),
      labour: cache.data.labour,
      labourLastWeek: cache.data.labourLastWeek,
      lastRefresh: cache.lastRefresh,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Alias /api/sales → returns sales data
app.get('/api/sales', requireAuth, async (req, res) => {
  try {
    res.json({
      period: getDateRange('thisWeek'),
      sales: cache.data.sales,
      lastRefresh: cache.lastRefresh,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Alias /api/xero → returns xero data
app.get('/api/xero', requireAuth, async (req, res) => {
  try {
    res.json({
      period: getDateRange('thisMonth'),
      xero: cache.data.xero,
      lastRefresh: cache.lastRefresh,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Force manual refresh (admin)
app.post('/api/refresh', requireAuth, async (req, res) => {
  res.json({ message: 'Refresh started' });
  refreshData();
});

// Deputy locations (for setup verification)
app.get('/api/setup/deputy', requireAuth, async (req, res) => {
  try {
    const locations = await deputy.getLocations();
    res.json({ success: true, locations });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Square locations (for setup verification)
app.get('/api/setup/square', requireAuth, async (req, res) => {
  try {
    const result = await square.discoverLocations();
    res.json({ success: true, ...result });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Xero status
app.get('/api/setup/xero', requireAuth, async (req, res) => {
  try {
    const tokens = xero.loadTokens ? null : null; // just check if tokens exist
    res.json({ success: true, authUrl: xero.getAuthUrl() });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── Start server ──────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`\n🚀 TSD Dashboard Backend running on port ${PORT}`);
  console.log(`   Deputy:  ${process.env.DEPUTY_SUBDOMAIN}`);
  console.log(`   Square:  App ${process.env.SQUARE_APP_ID?.slice(0,15)}...`);
  console.log(`   Xero:    Client ${process.env.XERO_CLIENT_ID?.slice(0,8)}...`);
  console.log(`   Refresh: 6am / 12pm / 6pm / 12am (Adelaide)\n`);

  // Initial data load on startup
  console.log('[Server] Running initial data refresh...');
  await refreshData();
});


// Reindex xero monthly data from stored history (run once after upgrade)
app.post('/api/xero/reindex', requireAuth, async (req, res) => {
  try {
    const stored = ingest.getStored('xero-pl');
    if (!stored) return res.json({ error: 'No xero-pl data stored' });

    const existing = stored;
    existing.byMonth = existing.byMonth || {};

    // Reprocess each file in history using stored filename for period key
    // We can't re-parse the bytes, but we can rebuild byMonth from history entries
    // that already have parsed venue data stored in a per-file cache
    // Better: store each parsed result in history entries

    res.json({ message: 'Use /api/xero/reupload — re-drop files in Drive to rebuild monthly index', 
               hint: 'The byMonth index was added after initial upload. Re-syncing files will fix it.' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ── Diagnostic: raw timesheet dump for a date range ─────────
app.get('/api/debug/timesheets', requireAuth, async (req, res) => {
  const start = req.query.start || getDateRange('lastWeek').start;
  const end   = req.query.end   || getDateRange('lastWeek').end;
  try {
    const data = await deputy.getLabourData(start, end);
    const DEP_MAP = {1:'TSD',2:'TLC',3:'NES',4:'LNM'};
    const summary = {};
    Object.entries(data.byLocation).forEach(([id, l]) => {
      summary[DEP_MAP[parseInt(id)] || 'id:'+id] = {
        hours: l.hours?.toFixed(1),
        cost: '$'+Math.round(l.cost||0).toLocaleString(),
        shifts: l.shifts,
        pendingShifts: l.pendingShifts || 0,
      };
    });
    // Sample first 3 raw timesheets to check field structure
    const sample = (data.raw.timesheets||[]).slice(0,3).map(ts => ({
      Id: ts.Id,
      Date: ts.Date,
      Employee: ts.Employee,
      Company: ts.Company,
      TotalTime: ts.TotalTime,
      Cost: ts.Cost,
      TimeApproved: ts.TimeApproved,
      metaCompany: ts._DPMetaData?.OperationalUnitInfo?.Company,
    }));
    // Full company ID breakdown
    const rawCompanyIds = {};
    (data.raw.timesheets||[]).forEach(ts => {
      const cid = String(ts.Company || ts._DPMetaData?.OperationalUnitInfo?.Company || 'null');
      rawCompanyIds[cid] = (rawCompanyIds[cid]||0) + 1;
    });
    const leaveCount = (data.raw.timesheets||[]).filter(ts => ts.IsLeave).length;
    const zeroCost = (data.raw.timesheets||[]).filter(ts => !ts.IsLeave && (ts.Cost === 0 || ts.Cost === null)).length;

    // Show null-company timesheets in full to understand what they are
    const nullCompany = (data.raw.timesheets||[])
      .filter(ts => !ts.Company && !ts._DPMetaData?.OperationalUnitInfo?.Company)
      .map(ts => ({
        Id: ts.Id, Date: ts.Date?.substring(0,10), Employee: ts.Employee,
        Company: ts.Company, OperationalUnit: ts.OperationalUnit,
        TotalTime: ts.TotalTime, Cost: ts.Cost, TimeApproved: ts.TimeApproved,
        metaKeys: ts._DPMetaData ? Object.keys(ts._DPMetaData) : [],
        metaCompany: ts._DPMetaData?.OperationalUnitInfo?.Company,
        metaOrgUnit: ts._DPMetaData?.OperationalUnitInfo,
      }));

    // Show all employees with cost=0
    const zeroCostSample = (data.raw.timesheets||[])
      .filter(ts => (ts.Cost === 0 || ts.Cost === null) && ts.TotalTime > 0)
      .slice(0,5)
      .map(ts => ({ Id: ts.Id, Employee: ts.Employee, hours: ts.TotalTime, approved: ts.TimeApproved, Company: ts.Company }));

    res.json({ start, end, isEstimated: data.isEstimated, unmatchedCount: data.unmatchedCount||0, totals: { hours: data.totalActualHours?.toFixed(1), cost: '$'+Math.round(data.totalWageCost).toLocaleString(), timesheets: data.timesheets, leaveTimesheets: leaveCount, pending: data.pendingTimesheets, zeroCostCount: zeroCost }, byVenue: summary, rawCompanyIds, nullCompanyTimesheets: nullCompany, zeroCostSample, sampleTimesheets: sample });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// Debug: look up specific employees by ID
app.get('/api/debug/employees', requireAuth, async (req, res) => {
  try {
    const employees = await deputy.getEmployees();
    const ids = req.query.ids ? req.query.ids.split(',').map(Number) : [];
    const filtered = ids.length
      ? employees.filter(e => ids.includes(e.Id))
      : employees.slice(0, 20);
    res.json(filtered.map(e => ({
      Id: e.Id,
      DisplayName: e.DisplayName,
      Company: e.Company,
      MainAddress: e.MainAddress,
      Active: e.Active,
      PayPoint: e.PayPoint,
    })));
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});


// Debug: dump all operational units (work areas) with company mapping
app.get('/api/debug/areas', requireAuth, async (req, res) => {
  try {
    const areas = await deputy.getAreas();
    res.json(areas.map(a => ({
      Id: a.Id,
      Name: a.OperationalUnitName,
      Company: a.Company,
      Active: a.Active,
      ParentOperationalUnit: a.ParentOperationalUnit,
    })));
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Data Drop Routes ──────────────────────────────────────────

// POST /api/data-drop/:source
// Accepts CSV text body, parses based on source type
// Sources: xero-pl, xero-balance, lightyear, square-items, custom
app.post('/api/data-drop/:source', requireAuth, (req, res) => {
  const { source } = req.params;
  const filename = req.headers['x-filename'] || `upload-${Date.now()}`;
  const fileBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

  if (!fileBuffer.length) {
    return res.status(400).json({ error: 'No file data in request body' });
  }

  const validSources = ['xero-pl', 'xero-balance', 'lightyear', 'square-items', 'custom'];
  const effectiveSource = validSources.includes(source) ? source : 'custom';

  try {
    const parsed = ingest.ingest(effectiveSource, fileBuffer, filename);
    res.json({
      success: true,
      source: effectiveSource,
      filename,
      summary: {
        uploadedAt: parsed.uploadedAt,
        venues: parsed.venues ? Object.keys(parsed.venues) : undefined,
        rowCount: parsed.rowCount,
        total: parsed.total,
      }
    });
  } catch (e) {
    console.error(`[Ingest] Error processing ${source}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/data-drop/:source — retrieve latest parsed data
app.get('/api/data-drop/:source', requireAuth, (req, res) => {
  const { source } = req.params;
  const stored = ingest.getStored(source);
  if (!stored) return res.status(404).json({ error: `No data found for source: ${source}` });
  res.json(stored);
});

// GET /api/data-drop — list all sources and their status
app.get('/api/data-drop', requireAuth, (req, res) => {
  res.json(ingest.getAllSources());
});


// ── Temporary root route until dashboard frontend is built ────
app.get('/', requireLogin, (req, res) => {
  const user = req.user;
  const fs = require('fs');
  const html = fs.readFileSync(__dirname + '/dashboard.html', 'utf8')
    .replace('__USER__', user?.name || user?.email || 'Guest');
  return res.send(html);
});

// Keep old holding page for reference — now replaced
app.get('/_old', requireLogin, (req, res) => {
  const user = req.user;
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>TSD Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f1117; color: #f9fafb; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 16px; padding: 48px 40px; max-width: 480px; width: 100%; text-align: center; }
    .tag { font-size: 11px; letter-spacing: 3px; color: #6b7280; text-transform: uppercase; margin-bottom: 8px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .sub { color: #6b7280; font-size: 14px; margin-bottom: 32px; }
    .user { background: #0f1117; border-radius: 8px; padding: 12px 16px; font-size: 14px; color: #10b981; margin-bottom: 24px; }
    .status { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 32px; }
    .stat { background: #0f1117; border-radius: 8px; padding: 16px; }
    .stat-label { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
    .stat-value { font-size: 18px; font-weight: 600; color: #10b981; }
    .stat-value.warn { color: #f59e0b; }
    .logout { color: #6b7280; font-size: 13px; text-decoration: none; }
    .logout:hover { color: #f9fafb; }
    .building { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="tag">The Seller Door Group</div>
    <h1>Dashboard</h1>
    <p class="sub">Backend is live and running</p>
    <div class="user">✅ Signed in as ${user?.name || user?.email} (${user?.email})</div>
    <div class="building">🚧 Dashboard frontend coming soon — backend APIs are live and collecting data</div>
    <div class="status">
      <div class="stat">
        <div class="stat-label">Square Sales</div>
        <div class="stat-value">Live ✓</div>
      </div>
      <div class="stat">
        <div class="stat-label">Deputy Labour</div>
        <div class="stat-value warn">Fixing</div>
      </div>
      <div class="stat">
        <div class="stat-label">Domain</div>
        <div class="stat-value">Live ✓</div>
      </div>
      <div class="stat">
        <div class="stat-label">Auth</div>
        <div class="stat-value">Live ✓</div>
      </div>
    </div>
    <a href="/auth/logout" class="logout">Sign out</a>
  </div>
</body>
</html>`);
});

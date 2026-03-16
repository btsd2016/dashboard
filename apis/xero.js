// ============================================================
// Xero API — GP from P&L, COGS from bills
// Auth: OAuth 2.0 (two orgs: "The Seller Door" + "The Seller Door - Nest")
// New granular scopes (app created after 2 March 2026)
// ============================================================

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const XERO_BASE = 'https://api.xero.com/api.xro/2.0';
const TOKEN_FILE = path.join(__dirname, '../.xero-tokens.json');

// Org names as they appear in Xero
const ORG_MAP = {
  'TSD_GROUP': 'The Seller Door',       // TSD + TLC + LNM (location-tagged)
  'NES': 'The Seller Door - Nest',       // Nest Kiosk only
};

// Xero GL account codes for Revenue and COGS (same in both orgs)
const REVENUE_CODES = ['200', '210', '211', '212', '213', '214', '215', '216', '217'];
const COGS_CODES = ['311', '312', '313', '315', '316', '317', '318'];
const LABOUR_CODES = ['477', '478']; // Wages and Salaries, Superannuation

// ── Token management ─────────────────────────────────────────

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

// ── OAuth 2.0 flow ───────────────────────────────────────────

function getAuthUrl() {
  const scopes = [
    'openid',
    'profile',
    'email',
    'offline_access',
    'accounting.reports.read',
    'accounting.transactions.read',
    'accounting.settings.read',
  ].join('%20');

  return `https://login.xero.com/identity/connect/authorize` +
    `?response_type=code` +
    `&client_id=${process.env.XERO_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.XERO_REDIRECT_URI)}` +
    `&scope=${scopes}` +
    `&state=tsd_dashboard`;
}

async function exchangeCodeForTokens(code) {
  const credentials = Buffer.from(
    `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.XERO_REDIRECT_URI,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero token exchange failed: ${text}`);
  }

  const tokens = await res.json();
  tokens.obtained_at = Date.now();

  // Get tenant list (which orgs this token has access to)
  const tenants = await getConnections(tokens.access_token);
  tokens.tenants = tenants;

  saveTokens(tokens);
  console.log('[Xero] ✅ Tokens obtained. Connected orgs:');
  tenants.forEach(t => console.log(`  ${t.tenantId}: ${t.tenantName}`));

  return tokens;
}

async function refreshTokens() {
  const stored = loadTokens();
  if (!stored.refresh_token) throw new Error('No Xero refresh token — need to re-authorise');

  const credentials = Buffer.from(
    `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero token refresh failed: ${text}`);
  }

  const tokens = await res.json();
  tokens.obtained_at = Date.now();
  tokens.tenants = stored.tenants; // preserve tenant list
  saveTokens(tokens);

  return tokens;
}

async function getValidToken() {
  let tokens = loadTokens();

  if (!tokens.access_token) {
    throw new Error('Xero not authorised — visit /xero/auth to connect');
  }

  // Refresh if within 5 minutes of expiry (tokens last 30min)
  const expiresAt = tokens.obtained_at + (tokens.expires_in * 1000);
  if (Date.now() > expiresAt - 300000) {
    console.log('[Xero] Refreshing access token...');
    tokens = await refreshTokens();
  }

  return tokens;
}

// ── Tenant/connection management ─────────────────────────────

async function getConnections(accessToken) {
  const res = await fetch('https://api.xero.com/connections', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  return res.json();
}

function getTenantId(orgKey) {
  const tokens = loadTokens();
  if (!tokens.tenants) return null;

  const orgName = ORG_MAP[orgKey];
  const tenant = tokens.tenants.find(t =>
    t.tenantName.includes(orgName) || orgName.includes(t.tenantName)
  );

  return tenant?.tenantId || null;
}

// ── API calls ─────────────────────────────────────────────────

async function xeroGet(path, tenantId) {
  const tokens = await getValidToken();

  const res = await fetch(`${XERO_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
      'Xero-Tenant-Id': tenantId,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero API error ${res.status}: ${path} — ${text}`);
  }

  return res.json();
}

// ── P&L Report ───────────────────────────────────────────────

async function getProfitAndLoss(orgKey, fromDate, toDate, trackingOption = null) {
  const tenantId = getTenantId(orgKey);
  if (!tenantId) throw new Error(`No tenant ID for org: ${orgKey}`);

  let path = `/Reports/ProfitAndLoss?fromDate=${fromDate}&toDate=${toDate}&periods=1&timeframe=MONTH`;

  if (trackingOption) {
    // For The Seller Door org — filter by location (Brighton/Henley/Marino)
    path += `&trackingOptionID=${trackingOption}`;
  }

  const data = await xeroGet(path, tenantId);
  return parsePLReport(data, orgKey);
}

function parsePLReport(data, orgKey) {
  const report = data.Reports?.[0];
  if (!report) return null;

  const result = {
    org: orgKey,
    period: report.ReportTitles?.[2] || '',
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    gpPct: 0,
    wages: 0,
    super: 0,
    labourTotal: 0,
  };

  // Parse report rows
  function parseSection(rows, section) {
    rows?.forEach(row => {
      if (row.RowType === 'Row' && row.Cells) {
        const label = row.Cells[0]?.Value || '';
        const amount = parseFloat(row.Cells[1]?.Value?.replace(/[,$]/g, '') || '0');

        if (section === 'Revenue') result.revenue += amount;
        if (section === 'CostOfSales') result.cogs += Math.abs(amount);
        if (section === 'Expenses') {
          if (label.includes('Wages') || label.includes('Salaries')) {
            if (!label.includes('Management')) result.wages += Math.abs(amount);
          }
          if (label.includes('Superannuation') && !label.includes('Management')) {
            result.super += Math.abs(amount);
          }
        }
      }
      if (row.Rows) {
        const sectionName = row.Title?.includes('Cost of Sales') ? 'CostOfSales' :
                            row.Title?.includes('Income') ? 'Revenue' :
                            row.Title?.includes('Expenses') ? 'Expenses' : section;
        parseSection(row.Rows, sectionName);
      }
    });
  }

  parseSection(report.Rows, '');

  result.grossProfit = result.revenue - result.cogs;
  result.gpPct = result.revenue > 0 ? (result.grossProfit / result.revenue * 100) : 0;
  result.labourTotal = result.wages + result.super;
  result.labourPct = result.revenue > 0 ? (result.labourTotal / result.revenue * 100) : 0;

  return result;
}

// ── Bills (COGS via accounts payable) ────────────────────────

async function getBills(orgKey, fromDate, toDate) {
  const tenantId = getTenantId(orgKey);
  if (!tenantId) throw new Error(`No tenant ID for org: ${orgKey}`);

  const path = `/Invoices?Type=ACCPAY&DateFrom=${fromDate}&DateTo=${toDate}&Status=AUTHORISED,PAID`;
  const data = await xeroGet(path, tenantId);

  const bills = data.Invoices || [];
  const cogsBills = bills.filter(bill =>
    bill.LineItems?.some(li => COGS_CODES.includes(li.AccountCode))
  );

  let totalCogs = 0;
  cogsBills.forEach(bill => {
    bill.LineItems?.forEach(li => {
      if (COGS_CODES.includes(li.AccountCode)) {
        totalCogs += li.LineAmount || 0;
      }
    });
  });

  return { bills: cogsBills.length, totalCogs };
}

// ── Tracking categories (for venue split in TSD org) ─────────

async function getTrackingCategories(orgKey) {
  const tenantId = getTenantId(orgKey);
  if (!tenantId) throw new Error(`No tenant ID for org: ${orgKey}`);

  const data = await xeroGet('/TrackingCategories', tenantId);
  const categories = data.TrackingCategories || [];

  console.log(`[Xero] Tracking categories for ${orgKey}:`);
  categories.forEach(cat => {
    console.log(`  ${cat.Name}:`);
    cat.Options?.forEach(opt => console.log(`    ${opt.TrackingOptionID}: ${opt.Name}`));
  });

  return categories;
}

// ── Main data fetch ───────────────────────────────────────────

async function getXeroData(fromDate, toDate) {
  console.log(`[Xero] Fetching P&L data ${fromDate} → ${toDate}`);

  const result = {};

  // Nest Kiosk — separate org, straightforward
  try {
    result.NES = await getProfitAndLoss('NES', fromDate, toDate);
    console.log(`[Xero] ✅ NES: Revenue $${result.NES.revenue?.toFixed(0)}, GP ${result.NES.gpPct?.toFixed(1)}%`);
  } catch (e) {
    console.error(`[Xero] ❌ NES: ${e.message}`);
    result.NES = { error: e.message };
  }

  // The Seller Door org — needs tracking category split
  try {
    // First get full org P&L (all venues combined)
    result.TSD_GROUP = await getProfitAndLoss('TSD_GROUP', fromDate, toDate);
    console.log(`[Xero] ✅ TSD Group: Revenue $${result.TSD_GROUP.revenue?.toFixed(0)}, GP ${result.TSD_GROUP.gpPct?.toFixed(1)}%`);

    // Then get tracking categories to split by venue
    const categories = await getTrackingCategories('TSD_GROUP');
    result.trackingCategories = categories;

  } catch (e) {
    console.error(`[Xero] ❌ TSD Group: ${e.message}`);
    result.TSD_GROUP = { error: e.message };
  }

  return result;
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getValidToken,
  getConnections,
  getProfitAndLoss,
  getBills,
  getTrackingCategories,
  getXeroData,
};

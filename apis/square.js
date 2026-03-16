// ============================================================
// Square API — Sales, Items, Hourly breakdown, Avg Transaction
// Auth: Bearer token (production)
// All 4 venues under one account — filter by Location ID
// ============================================================

const fetch = require('node-fetch');

const SQUARE_BASE = 'https://connect.squareup.com/v2';
const HEADERS = {
  'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
  'Square-Version': '2024-01-17',
};

// Venue → Square Location ID mapping
// Pre-seeded with confirmed IDs — discoverLocations() will verify/update
let LOCATION_MAP = {
  NES: 'LF1KQVMFAYNSS',   // Nest Kiosk — Kingston Park
  TSD: '2BH1RVZKBBZVH',   // The Seller Door — Brighton
  TLC: 'LTAGREJCMF159',   // The Local Canteen — Henley
  LNM: 'L6PQXFACXG69H',  // Little Nest — Marino
};

// Our venue codes → Square location names (for matching)
const VENUE_NAME_MAP = {
  'NES': ['Nest', 'Kingston'],
  'TSD': ['Seller Door', 'Brighton'],
  'TLC': ['Local Canteen', 'Henley'],
  'LNM': ['Marino', 'Little Nest'],
};

// ── Helpers ──────────────────────────────────────────────────

async function squareGet(path) {
  const res = await fetch(`${SQUARE_BASE}${path}`, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Square API error ${res.status}: ${path} — ${body}`);
  }
  return res.json();
}

async function squarePost(path, body) {
  const res = await fetch(`${SQUARE_BASE}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Square POST error ${res.status}: ${path} — ${text}`);
  }
  return res.json();
}

// ── Location discovery ────────────────────────────────────────

async function discoverLocations() {
  const data = await squareGet('/locations');
  const locations = data.locations || [];

  console.log('[Square] Locations found:');
  locations.forEach(loc => {
    console.log(`  ${loc.id}: ${loc.name} (${loc.status})`);

    // Auto-map to our venue codes
    for (const [code, keywords] of Object.entries(VENUE_NAME_MAP)) {
      if (keywords.some(kw => loc.name.toLowerCase().includes(kw.toLowerCase()))) {
        LOCATION_MAP[code] = loc.id;
        console.log(`    → Mapped to ${code}`);
      }
    }
  });

  return { locations, locationMap: LOCATION_MAP };
}

// ── Orders / Sales for a date range ──────────────────────────
// Square dates must be RFC 3339 format with timezone

function toSquareDate(dateStr, endOfDay = false) {
  // dateStr: YYYY-MM-DD → convert to Adelaide time (UTC+10:30 or +9:30)
  const time = endOfDay ? 'T23:59:59+09:30' : 'T00:00:00+09:30';
  return `${dateStr}${time}`;
}

async function getOrders(locationId, startDate, endDate) {
  const body = {
    location_ids: [locationId],
    query: {
      filter: {
        date_time_filter: {
          closed_at: {
            start_at: toSquareDate(startDate),
            end_at: toSquareDate(endDate, true),
          },
        },
        state_filter: { states: ['COMPLETED'] },
      },
      sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' },
    },
    limit: 500,
  };

  let allOrders = [];
  let cursor = null;

  do {
    if (cursor) body.cursor = cursor;
    const data = await squarePost('/orders/search', body);
    allOrders = allOrders.concat(data.orders || []);
    cursor = data.cursor;
  } while (cursor);

  return allOrders;
}

// ── Payments summary (faster than orders for high-level totals) ──

async function getPaymentsSummary(locationId, startDate, endDate) {
  let allPayments = [];
  let cursor = null;

  do {
    let path = `/payments?location_id=${locationId}&begin_time=${toSquareDate(startDate)}&end_time=${toSquareDate(endDate, true)}&limit=200`;
    if (cursor) path += `&cursor=${cursor}`;

    const data = await squareGet(path);
    allPayments = allPayments.concat(data.payments || []);
    cursor = data.cursor;
  } while (cursor);

  return allPayments;
}

// ── Category/Item sales breakdown ────────────────────────────

async function getCategorySales(locationId, startDate, endDate) {
  // Use the Reports API for category breakdown
  const body = {
    location_id: locationId,
    date_range: {
      start_date: startDate,  // YYYY-MM-DD
      end_date: endDate,
    },
  };

  try {
    // Item sales via orders (more reliable than reports endpoint)
    const orders = await getOrders(locationId, startDate, endDate);

    const itemSales = {};
    const categorySales = {};
    let totalNet = 0;
    let transactionCount = 0;

    orders.forEach(order => {
      if (!order.line_items) return;
      transactionCount++;

      order.line_items.forEach(item => {
        const name = item.name || 'Unknown';
        const category = item.variation_name || 'Other';
        const qty = parseInt(item.quantity || 1);
        const grossAmt = (item.gross_sales_money?.amount || 0) / 100;
        const discounts = (item.total_discount_money?.amount || 0) / 100;
        const netAmt = grossAmt - discounts;

        // Items
        if (!itemSales[name]) itemSales[name] = { qty: 0, net: 0 };
        itemSales[name].qty += qty;
        itemSales[name].net += netAmt;

        totalNet += netAmt;
      });
    });

    // Sort items by revenue
    const topItems = Object.entries(itemSales)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.net - a.net)
      .slice(0, 20);

    return {
      totalNet,
      transactionCount,
      avgTransaction: transactionCount > 0 ? totalNet / transactionCount : 0,
      topItems,
      orderCount: orders.length,
    };

  } catch (e) {
    console.error('[Square] Category sales error:', e.message);
    return null;
  }
}

// ── Hourly sales breakdown ────────────────────────────────────

async function getHourlySales(locationId, startDate, endDate) {
  const orders = await getOrders(locationId, startDate, endDate);

  const hourly = {};
  for (let h = 0; h < 24; h++) hourly[h] = { sales: 0, transactions: 0 };

  orders.forEach(order => {
    if (!order.closed_at) return;
    const hour = new Date(order.closed_at).getHours();
    const net = (order.net_amount_due_money?.amount || order.total_money?.amount || 0) / 100;
    hourly[hour].sales += net;
    hourly[hour].transactions++;
  });

  return hourly;
}

// ── Main data fetch for all venues ───────────────────────────

async function getSalesData(startDate, endDate) {
  console.log(`[Square] Fetching sales data ${startDate} → ${endDate}`);

  // Ensure locations are mapped
  if (Object.keys(LOCATION_MAP).length === 0) {
    await discoverLocations();
  }

  const result = {};

  for (const [venueCode, locationId] of Object.entries(LOCATION_MAP)) {
    try {
      console.log(`[Square] Fetching ${venueCode} (${locationId})...`);
      const sales = await getCategorySales(locationId, startDate, endDate);
      const hourly = await getHourlySales(locationId, startDate, endDate);

      result[venueCode] = {
        locationId,
        ...sales,
        hourly,
      };

      console.log(`[Square] ✅ ${venueCode}: $${sales?.totalNet?.toFixed(2)} net, ${sales?.transactionCount} transactions`);
    } catch (e) {
      console.error(`[Square] ❌ ${venueCode}: ${e.message}`);
      result[venueCode] = { error: e.message };
    }
  }

  return result;
}

module.exports = {
  discoverLocations,
  getOrders,
  getPaymentsSummary,
  getCategorySales,
  getHourlySales,
  getSalesData,
  LOCATION_MAP,
};

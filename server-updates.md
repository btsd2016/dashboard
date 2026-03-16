# Server.js Updates Needed

## Issue
- `/api/status` route not implemented
- `/api/data` route exists but should be `/api/labour`
- All routes require authentication

## Required Fixes

### 1. Add Public Status Endpoint (after line 27)
```javascript
// ── Public Status Endpoint ──────────────────────────────────────
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
```

### 2. Change /api/data to /api/labour
Line 299: Change `app.get('/api/data', requireAuth, ...)`  
To: `app.get('/api/labour', requireAuth, ...)`

### 3. Add Sales Route
```javascript
app.get('/api/sales', requireAuth, async (req, res) => {
  try {
    const data = cache.data.sales || { totalSales: 0, byLocation: {} };
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

### 4. Fix Xero Route
Ensure `/api/xero` endpoint exists and returns P&L data

## Testing
```bash
# After fixing:
curl https://dashboard.thesellerdoor.com.au/api/status

curl https://dashboard.thesellerdoor.com.au/api/labour \
  -H "Cookie: connect.sid=YOUR_SESSION"
```

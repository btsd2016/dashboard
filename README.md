# TSD Group Dashboard Backend

**Live hospitality operations dashboard** for The Seller Door Group — integrating Deputy (HR/Labour), Square (POS), and Xero (Accounting) into unified real-time analytics.

## 🚀 Quick Start

### Local Development
```bash
npm install
npm run dev
# Opens on http://localhost:3000
```

### Production Deployment
See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete Railway.app setup guide.

## 📊 Features

- **Real-time Labour Data** — Deputy timesheets, approved hours, cost tracking
- **Sales Analytics** — Square POS integration by location
- **Financial Insights** — Xero P&L data, GP%, revenue trends
- **AI-Powered Summaries** — Claude API generates 3 actionable daily insights
- **Scheduled Refresh** — Cron jobs at 6am, 12pm, 6pm, 12am Adelaide time
- **Secure Access** — Google OAuth with whitelist (Ben, Andy, Tom)
- **Manual Data Import** — CSV upload for accounting exports

## 🏗️ Architecture

```
Express Server (Node.js)
├── Auth Middleware (Google OAuth)
├── REST API Endpoints (/api/labour, /api/sales, /api/xero, etc.)
├── Cron Scheduler (every 6 hours)
├── In-Memory Cache
└── External APIs
    ├── Deputy (labour)
    ├── Square (sales)
    ├── Xero (accounting)
    └── Claude (AI insights)
```

## 📝 API Endpoints

### Labour Data
- `GET /api/labour` — This week's labour data
- `GET /api/labour/:period` — By period (thisWeek, lastWeek, thisMonth, lastMonth)
- `GET /api/debug/labour?start=2025-03-01&end=2025-03-16` — Raw timesheet breakdown

### Sales Data
- `GET /api/sales` — POS sales by location
- `GET /api/sales/:period` — Sales by period

### Accounting
- `GET /api/xero` — Monthly P&L or OAuth redirect
- `GET /auth/xero/callback?code=...` — OAuth completion

### Data Uploads
- `POST /api/data-drop/:source` — Upload CSV (xero-pl, square-items, custom)
- `GET /api/data-drop` — List all sources
- `GET /api/data-drop/:source` — Get latest data for source

### System
- `GET /api/status` — Cache status, last refresh time
- `GET /` — Frontend dashboard (requires login)
- `GET /login` — Google OAuth login page

## 🔐 Authentication

1. Visit `http://YOUR_DOMAIN/login`
2. Click "Sign in with Google"
3. Account must be in whitelist (auth.js):
   - ben@thesellerdoor.com.au
   - andy@thesellerdoor.com.au
   - tom@thesellerdoor.com.au

## ⚙️ Configuration

### Environment Variables

Create `.env` from `.env.example`:

```bash
cp .env.example .env
# Edit .env with your credentials
```

**Required Variables:**
- `DEPUTY_SUBDOMAIN` — Deputy API subdomain
- `DEPUTY_TOKEN` — 10-year Deputy bearer token
- `SQUARE_APP_ID` & `SQUARE_ACCESS_TOKEN` — Square API credentials
- `XERO_CLIENT_ID` & `XERO_CLIENT_SECRET` — Xero OAuth credentials
- `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` — Google OAuth credentials
- `SESSION_SECRET` — Session encryption key (32+ bytes)

**Optional:**
- `ANTHROPIC_API_KEY` — Claude API key (for daily AI insights)

See `.env.example` for full reference.

## 📅 Scheduled Tasks

Cron jobs refresh data 4 times daily (Adelaide time):

| Time | Task |
|------|------|
| **6:00 AM** | Fetch Deputy labour, Square sales, Xero P&L |
| **12:00 PM** | Refresh all data |
| **6:00 PM** | Refresh all + generate AI insights |
| **12:00 AM** | Final refresh of the day |

UTC times vary with DST. See [DEPLOYMENT.md](./DEPLOYMENT.md#scheduled-refresh-cron) for exact times.

## 🛠️ Development

### Scripts

```bash
npm start      # Run production server
npm run dev    # Run with nodemon (auto-reload)
npm ls         # Check dependencies
```

### Project Structure

```
├── server.js               Main Express app + cron scheduler
├── auth.js                 Google OAuth + session management
├── apis/
│   ├── deputy.js          Deputy API wrapper
│   ├── square.js          Square API wrapper
│   ├── xero.js            Xero API wrapper
│   └── ingest.js          CSV parsing for data uploads
├── services/
│   ├── labourEstimator.js Labour cost estimation
│   └── xeroRates.json     Venue cost reference data
├── dashboard.html         Frontend UI
└── google-drive-sync/     Google Sheets integration (optional)
```

### Dependencies

- **express** ^4.18.2 — Web framework
- **node-cron** ^3.0.3 — Scheduled tasks
- **node-fetch** ^2.7.0 — HTTP requests
- **passport** ^0.7.0 — Authentication
- **passport-google-oauth20** ^2.0.0 — Google OAuth strategy
- **express-session** ^1.17.3 — Session management
- **cors** ^2.8.5 — Cross-origin requests
- **dotenv** ^16.3.1 — Environment variables
- **xlsx** ^0.18.5 — Excel/CSV parsing

## 🐛 Debugging

### Check Data Status

```bash
# Labour data breakdown
curl http://localhost:3000/api/debug/labour?start=2025-03-10&end=2025-03-16

# Deputy employees
curl http://localhost:3000/api/debug/employees

# Deputy work areas
curl http://localhost:3000/api/debug/areas

# System cache status
curl http://localhost:3000/api/status
```

### View Logs

**Local:**
```bash
npm run dev
# Logs print to console
```

**Production (Railway):**
1. Go to https://railway.app
2. Select project → Deployments
3. Click latest deployment → Logs tab

### Common Issues

See [DEPLOYMENT.md — Troubleshooting](./DEPLOYMENT.md#troubleshooting) for solutions to:
- Server won't start
- Google OAuth failing
- API calls returning 401
- Cron jobs not running
- Labour data quality issues

## 📦 Deployment

### Railway.app (Recommended)

1. Read [DEPLOYMENT.md](./DEPLOYMENT.md)
2. Connect GitHub repository
3. Set environment variables
4. Add custom domain
5. Deploy on git push

### Local Server

```bash
npm install
npm start
```

Server runs on port 3000 (or `$PORT` env var).

## 🔒 Security Notes

⚠️ **Never commit `.env` to version control!**  
Use Railway environment variables for production.

✅ **Secure defaults:**
- Google OAuth whitelist (only 3 emails)
- CSRF protection (sameSite cookies)
- HTTPS enforced (Railway auto-SSL)
- Bearer token rotation (Xero)

## 📈 Performance

- **Memory:** ~50-100 MB typical (watch for leaks)
- **Refresh time:** ~5-10 seconds per cycle
- **API rate limits:** Safe with current schedule
- **Caching:** In-memory; persists until server restart

## 🚀 Future Enhancements

- [ ] PostgreSQL for historical data
- [ ] WebSocket for real-time updates
- [ ] Slack integration for daily summaries
- [ ] Advanced analytics & forecasting
- [ ] Mobile app (iOS/Android)
- [ ] Custom reporting builder
- [ ] Automated alerts (labour %, GP thresholds)
- [ ] Audit trail for compliance

## 📞 Support

**Developers:** Tom, Ben, Andy  
**Hosting:** Railway.app  
**Domain:** dashboard.thesellerdoor.com.au  

**Need help?**
1. Check [DEPLOYMENT.md](./DEPLOYMENT.md)
2. Review logs: Railway dashboard → Deployments
3. Test endpoints: `/api/debug/*`
4. Contact development team

## 📄 License

Internal use only — The Seller Door Group

---

**Last Updated:** March 2025  
**Status:** Production-ready ✅
# Updated: Mon 16 Mar 2026 12:22:28 ACDT

# TSD Group Dashboard — Deployment Guide

## Quick Start (Railway.app)

### Prerequisites
- Railway.app account (free tier sufficient)
- GitHub account with repository access
- Node.js 18+ LTS (for local testing)

### 1. Create Railway Project

1. Go to https://railway.app
2. Click "New Project" → "Deploy from GitHub"
3. Select this repository
4. Railway auto-detects Node.js and creates `Procfile`

### 2. Configure Environment Variables

In Railway Dashboard → Settings → Environment Variables, add:

```
# ========================================
# COPY ALL THESE AND POPULATE WITH REAL KEYS
# ========================================

# Deputy API (HR/Labour)
DEPUTY_SUBDOMAIN=YOUR_SUBDOMAIN.au.deputy.com
DEPUTY_TOKEN=YOUR_10_YEAR_BEARER_TOKEN

# Square POS
SQUARE_APP_ID=sq0idp-YOUR_APP_ID
SQUARE_ACCESS_TOKEN=YOUR_SQUARE_TOKEN

# Xero Accounting
XERO_CLIENT_ID=YOUR_CLIENT_ID
XERO_CLIENT_SECRET=YOUR_CLIENT_SECRET
XERO_REDIRECT_URI=https://YOUR_DOMAIN/auth/xero/callback

# Google OAuth (for dashboard login)
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
GOOGLE_CALLBACK_URL=https://YOUR_DOMAIN/auth/google/callback

# Session Management (generate with: openssl rand -hex 32)
SESSION_SECRET=YOUR_RANDOM_32_BYTE_HEX_STRING

# AI Insights (optional)
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY

# Server Configuration
PORT=3000
NODE_ENV=production
```

### 3. Add Custom Domain

Railway → Project Settings → Domains → Add Domain
```
dashboard.thesellerdoor.com.au
```

### 4. Deploy

```bash
# Railway automatically deploys on Git push
git push origin main
```

Check status at: https://railway.app/project

---

## Local Development

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create .env file with development credentials
cp .env.example .env
# Edit .env with your API keys

# 3. Start with nodemon (auto-reload)
npm run dev

# Server runs on http://localhost:3000
```

### Testing Endpoints

```bash
# Check if server is running
curl http://localhost:3000

# Login at:
# http://localhost:3000/login

# Once authenticated:
curl -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  http://localhost:3000/api/labour

# Check cron status
curl http://localhost:3000/api/status
```

---

## Production Checklist

### Security
- [ ] Migrate `.env` credentials to Railway env vars (never commit .env)
- [ ] Enable HTTPS (Railway provides auto SSL)
- [ ] Verify SESSION_SECRET is strong (32+ bytes random)
- [ ] Confirm Google whitelist emails are correct (auth.js)
- [ ] Test OAuth callback with correct domain

### Data
- [ ] Verify Deputy company mapping (use `/api/debug/areas`)
- [ ] Check Square location discovery works
- [ ] Test Xero P&L endpoint with OAuth flow
- [ ] Validate AI insights generation at 6pm Adelaide time

### Monitoring
- [ ] Set up Railway alerts for errors
- [ ] Monitor memory usage (target: <500MB)
- [ ] Check cron job logs every morning
- [ ] Set up uptime monitoring (UptimeRobot, etc.)

### Backups
- [ ] Configure Railway automatic backups
- [ ] Test manual backup/restore process
- [ ] Document disaster recovery plan

---

## Troubleshooting

### Server won't start
```bash
# Check logs
railway logs

# Verify Node version
node --version  # Should be 18+

# Check package.json syntax
npm ls
```

### Google OAuth failing
```bash
# Verify callback URL matches exactly
# Railway domain: https://YOUR-PROJECT-abc123.railway.app
# Custom domain: https://dashboard.thesellerdoor.com.au

# Both should be in Google Console OAuth2 settings
# Client ID: YOUR_ID.apps.googleusercontent.com
# Authorized redirect URIs: 
#   https://YOUR-PROJECT-abc123.railway.app/auth/google/callback
#   https://dashboard.thesellerdoor.com.au/auth/google/callback
```

### API calls returning 401
```bash
# Usually: expired Deputy token or Xero OAuth
# Check: /api/debug/employees
# If fails, Deputy token needs refresh

# For Xero: Navigate to /api/xero
# Should show: { authRequired: true, authUrl: "https://..." }
# Follow auth URL to complete OAuth flow
```

### Cron jobs not running
```bash
# Check if server is stuck
# Railway → Deployments → Logs

# Cron runs at these times (Adelaide UTC+9:30):
# 06:00 → 20:30 UTC (or 21:30 DST)
# 12:00 → 02:30 UTC (or 03:30 DST)
# 18:00 → 08:30 UTC (or 09:30 DST)
# 00:00 → 14:30 UTC (or 15:30 DST)

# Wait for scheduled time, then check logs
```

### Labour data missing zero-cost entries
```bash
# This is expected behavior — entries with Cost=0 are flagged
# Check debug endpoint:
curl http://localhost:3000/api/debug/labour?start=2025-03-01&end=2025-03-16

# Look for "zeroCostSample" in response
# Review Deputy pay rates for affected employees
```

---

## Maintenance Tasks

### Weekly
- [ ] Review `/api/debug/labour` for data quality issues
- [ ] Check Railway resource usage (CPU, memory)
- [ ] Verify all OAuth tokens still valid

### Monthly
- [ ] Audit whitelist emails (auth.js)
- [ ] Review API error logs
- [ ] Update venue benchmarks if needed (server.js line 196)
- [ ] Test manual data-drop upload

### Quarterly
- [ ] Security audit of API keys
- [ ] Review Anthropic API usage (billing)
- [ ] Plan major version updates (Express, node-cron, etc.)

---

## Scaling Beyond Single Instance

### When to Scale
- User base exceeds 10 concurrent users
- Memory usage consistently >400MB
- Response times exceed 2 seconds

### Upgrade Path
1. **Add Database:** PostgreSQL on Railway for historical data
2. **Add Cache:** Redis for session + API response caching
3. **Load Balancer:** Railway auto-handles with multiple instances
4. **Separate Workers:** Move cron jobs to background queue (Bull, RabbitMQ)

See `SCALING.md` for detailed instructions.

---

## Support & Contacts

**Hosting:** Railway.app (Status: https://www.railwaystatus.com)  
**Domain:** dashboard.thesellerdoor.com.au  
**Developers:** Tom, Ben, Andy  

**Emergency Access:**
1. Railway dashboard: https://railway.app
2. Logs: Railway → Project → Deployments
3. SSH: Not available on Railway free tier; use Railway Shell instead

---

## Environment Variables Reference

| Variable | Required | Format | Example |
|----------|----------|--------|---------|
| DEPUTY_SUBDOMAIN | ✅ | subdomain.au.deputy.com | 827eb203093602.au.deputy.com |
| DEPUTY_TOKEN | ✅ | Bearer token | a3266c9a335f6b1edba6885ead695cdb |
| SQUARE_APP_ID | ✅ | sq0idp-... | sq0idp-jVB3Z3k3jZj3bXuIUA1PGg |
| SQUARE_ACCESS_TOKEN | ✅ | EAAA... | EAAAl_Xj-x07WI6JWROgpHpxWCkdwGG... |
| XERO_CLIENT_ID | ✅ | UUID | C0561627C8B24A46A27BA2F12997089D |
| XERO_CLIENT_SECRET | ✅ | Random string | 6y7kDrstuxBDOH3sCP_cmhV0vVduFKXT... |
| GOOGLE_CLIENT_ID | ✅ | numbers-...apps.googleusercontent.com | 277693188987-...apps.googleusercontent.com |
| GOOGLE_CLIENT_SECRET | ✅ | GOCSPX-... | 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 |
| SESSION_SECRET | ✅ | 32+ byte hex | (generated with openssl rand -hex 32) |
| ANTHROPIC_API_KEY | ❌ | sk-ant-... | sk-ant-v0-aKzJ9xQpQ... |
| PORT | ❌ | number | 3000 |
| NODE_ENV | ❌ | production\|development | production |

---

## First-Time Setup Checklist

- [ ] Read this entire guide
- [ ] Create Railway account
- [ ] Fork/clone repository to GitHub
- [ ] Set up all environment variables in Railway
- [ ] Add custom domain (or use Railway domain)
- [ ] Deploy and test Google OAuth login
- [ ] Verify Deputy API connectivity (`/api/debug/employees`)
- [ ] Verify Square API connectivity (check locations)
- [ ] Complete Xero OAuth flow
- [ ] Wait for first cron refresh (6am/12pm/6pm/12am Adelaide)
- [ ] Verify AI insights generation at 6pm
- [ ] Set up monitoring/alerts
- [ ] Share access with Ben, Andy, Tom


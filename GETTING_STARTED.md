# Getting Started with TSD Dashboard

## 📦 What's Included

This package contains everything needed to deploy the TSD Group Dashboard backend:

```
├── server.js                  Main application
├── auth.js                    Authentication setup
├── package.json               Dependencies
├── .env.example               Template for environment variables
├── dashboard.html             Frontend UI
├── apis/                      External API wrappers
├── services/                  Business logic
├── google-drive-sync/         Google Sheets integration
├── README.md                  Full documentation
└── DEPLOYMENT.md              Railway.app deployment guide
```

## ⚡ 5-Minute Quickstart

### Option 1: Deploy to Railway.app (Recommended)

1. **Create Account**
   - Go to https://railway.app
   - Sign up with GitHub

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub"
   - Choose this repository

3. **Add Environment Variables**
   - Railway → Project Settings → Environment Variables
   - Copy all variables from `DEPLOYMENT.md`
   - Fill in your actual API keys:
     - Deputy token & subdomain
     - Square credentials
     - Xero credentials
     - Google OAuth credentials
     - Session secret

4. **Add Custom Domain**
   - Railway → Project Settings → Domains
   - Add: `dashboard.thesellerdoor.com.au`

5. **Done!**
   - Railway auto-deploys on git push
   - Visit https://dashboard.thesellerdoor.com.au/login

### Option 2: Local Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env  # or your preferred editor

# Start server with auto-reload
npm run dev

# Visit http://localhost:3000/login
```

## 🔑 Required API Keys

Before deploying, gather these credentials:

| Service | Where to Get | Used For |
|---------|-------------|----------|
| **Deputy** | deputy.com settings | Labour data, timesheets |
| **Square** | squareup.com developers | POS sales, locations |
| **Xero** | xero.com app management | Accounting, P&L |
| **Google** | console.cloud.google.com | Dashboard login |
| **Anthropic** (optional) | console.anthropic.com | Daily AI insights |

## 🧪 Test Your Deployment

Once live, verify everything works:

```bash
# 1. Check if server is running
curl https://dashboard.thesellerdoor.com.au/

# 2. Test Google login
# Open in browser: https://dashboard.thesellerdoor.com.au/login
# Sign in with your Google account (must be in whitelist)

# 3. Test Labour API
curl https://dashboard.thesellerdoor.com.au/api/labour \
  -H "Cookie: your_session_cookie_here"

# 4. Check system status
curl https://dashboard.thesellerdoor.com.au/api/status

# 5. Debug API issues
curl https://dashboard.thesellerdoor.com.au/api/debug/employees
curl https://dashboard.thesellerdoor.com.au/api/debug/areas
```

## 📋 Deployment Checklist

- [ ] All environment variables configured
- [ ] Domain added and DNS updated
- [ ] Google OAuth whitelist verified (auth.js)
- [ ] Deputy credentials tested
- [ ] Square credentials tested
- [ ] Xero OAuth flow completed
- [ ] Google login works
- [ ] AI insights enabled (if using)
- [ ] Monitoring/alerts set up
- [ ] Backup/recovery plan documented

## 🔐 Security Reminders

⚠️ **CRITICAL:**
- Never commit `.env` file
- Use Railway environment variables for production
- Keep API keys secret
- Rotate tokens regularly
- Enable HTTPS (Railway auto-enables)

## 📚 Full Documentation

- **[README.md](./README.md)** — Complete feature overview
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** — Detailed Railway setup + troubleshooting
- **[../analysis.md](../analysis.md)** — Code architecture review

## 🆘 Need Help?

### Check Logs
```bash
# If deployed on Railway:
# 1. Go to https://railway.app
# 2. Select your project
# 3. Click Deployments → Latest → Logs
```

### Common Issues

**Server won't start**
- Check Node version: `node --version` (should be 18+)
- Check syntax: `npm ls`

**Google OAuth failing**
- Verify callback URL in Google Console matches your domain
- Ensure SESSION_SECRET is set

**API calls returning 401**
- Deputy token may be expired
- Xero may need OAuth re-auth
- Check `/api/debug/employees` endpoint

**Cron jobs not running**
- Wait for scheduled time (6am/12pm/6pm/12am Adelaide)
- Check logs in Railway dashboard

## 📞 Contact

**Development Team:** Tom, Ben, Andy  
**Platform:** Railway.app  
**Domain:** dashboard.thesellerdoor.com.au  

---

**Ready to deploy?** Start with [DEPLOYMENT.md](./DEPLOYMENT.md)


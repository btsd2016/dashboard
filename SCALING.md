# Scaling Guide for TSD Dashboard

When you outgrow single-instance deployment.

## When to Scale

Scale if you're experiencing any of:
- More than 10 concurrent dashboard users
- Memory consistently above 400MB
- Response times exceeding 2 seconds
- Cron refresh cycles taking >30 seconds

## Phase 1: Optimize Current Setup (Week 1)

### 1. Enable Caching Headers
```javascript
// In server.js, add to API endpoints:
res.set('Cache-Control', 'public, max-age=300'); // 5 minutes
```

### 2. Implement Request Timeout
```javascript
// In apis/deputy.js, square.js, xero.js:
const timeout = 30000; // 30 seconds
```

### 3. Monitor Memory
```bash
# Add memory monitoring endpoint:
app.get('/api/metrics', (req, res) => {
  const used = process.memoryUsage();
  res.json({
    heapUsed: Math.round(used.heapUsed / 1024 / 1024) + 'MB',
    heapTotal: Math.round(used.heapTotal / 1024 / 1024) + 'MB',
    external: Math.round(used.external / 1024 / 1024) + 'MB'
  });
});
```

## Phase 2: Add Redis Cache (Week 2-3)

### Install Redis
```bash
npm install redis
```

### Replace In-Memory Cache
```javascript
const redis = require('redis');
const client = redis.createClient({ url: process.env.REDIS_URL });

// Store cache in Redis instead of memory
app.get('/api/labour', async (req, res) => {
  const cached = await client.get('labour:thisWeek');
  if (cached) return res.json(JSON.parse(cached));
  
  // Fetch fresh data...
  await client.setEx('labour:thisWeek', 300, JSON.stringify(data)); // 5 min TTL
});
```

### Railway Redis
- Railway → New Service → Redis
- Copy `REDIS_URL` to environment variables

## Phase 3: Add PostgreSQL Database (Month 1)

### Why Database?
- Persist historical data (multi-year trends)
- Enable multi-instance deployment
- Support advanced queries (reports, analytics)
- Better performance than memory

### Setup
```bash
npm install pg
```

### Create Tables
```sql
CREATE TABLE labour_data (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  venue VARCHAR(50) NOT NULL,
  hours DECIMAL(8,2),
  cost DECIMAL(10,2),
  timesheets INT,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX (date, venue)
);

CREATE TABLE sales_data (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  location VARCHAR(100),
  sales DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX (date, location)
);

CREATE TABLE xero_data (
  id SERIAL PRIMARY KEY,
  month DATE NOT NULL,
  revenue DECIMAL(12,2),
  cogs DECIMAL(12,2),
  expenses DECIMAL(12,2),
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX (month)
);
```

### Store Data in DB
```javascript
// After refreshing data:
await db.query(
  'INSERT INTO labour_data (date, venue, hours, cost, timesheets) VALUES ($1, $2, $3, $4, $5)',
  [date, venue, hours, cost, count]
);
```

### Railway PostgreSQL
- Railway → New Service → PostgreSQL
- Copy `DATABASE_URL` to environment variables

## Phase 4: Separate Cron Worker (Month 2)

### Current Problem
- Cron runs on same instance as web server
- Blocks HTTP requests during refresh
- Can't scale web and worker independently

### Solution: Bull Queue
```bash
npm install bull
```

### Example
```javascript
const Queue = require('bull');
const refreshQueue = new Queue('data-refresh', process.env.REDIS_URL);

// Web server just adds job to queue
app.post('/api/refresh-now', async (req, res) => {
  await refreshQueue.add({}, { priority: 10 });
  res.json({ queued: true });
});

// Separate worker process
refreshQueue.process(async (job) => {
  await refreshData();
  job.progress(100);
});

// Or trigger from web server if still single instance:
// cron.schedule('30 20 * * *', () => refreshQueue.add({}));
```

## Phase 5: Multi-Instance Deployment (Month 3)

### Scale Horizontally on Railway
```
1 web instance + 1 worker instance + Redis + PostgreSQL
↓
3 web instances + 2 worker instances + Redis + PostgreSQL
```

**Railway Deployment:**
```dockerfile
# Dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Option 1: Web server
CMD ["npm", "start"]

# Option 2: Worker process
CMD ["node", "worker.js"]
```

## Phase 6: CDN + Monitoring (Month 4+)

### CloudFront CDN
- Cache dashboard.html
- Serve frontend assets from edge locations
- Reduce latency globally

### Monitoring
```bash
npm install datadog winston prometheus-client
```

Options:
- **DataDog** — APM, logs, metrics
- **New Relic** — Performance monitoring
- **Prometheus** — Open-source metrics

## Cost Estimate

| Phase | Service | Cost/Month |
|-------|---------|-----------|
| **Current** | Railway (web) | $5-20 |
| **+ Redis** | Railway Redis | +$15 |
| **+ Database** | Railway PostgreSQL | +$15 |
| **+ Worker** | Railway (2nd instance) | +$5-20 |
| **+ CDN** | CloudFront | +$0.085/GB |
| **Total (scaled)** | All together | ~$50-70 |

## Testing Load

Before scaling, test your app:

```bash
npm install -g autocannon

# Simulate 50 concurrent users for 30 seconds
autocannon -c 50 -d 30 http://localhost:3000
```

Expected results (single instance):
- ~200-500 req/sec
- <100ms latency
- 0% errors

If exceeded, move to Phase 1-2 (caching, Redis).

## Monitoring Checklist

- [ ] RAM usage alert at 400MB
- [ ] CPU alert above 80%
- [ ] Response time alert >2sec
- [ ] Error rate alert above 1%
- [ ] Cron job completion alerts
- [ ] API key expiration alerts

---

**Start with Phase 1 (optimization) first — it's free and often solves 80% of issues.**

When ready to scale beyond single instance, follow Phases 2-5 sequentially.


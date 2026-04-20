const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { fetchAllData, computeTaco, computeKpi } = require('./fetcher');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const UPDATE_TOKEN = process.env.UPDATE_TOKEN || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== GET /api/data ==========
app.get('/api/data', (req, res) => {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    // Ensure taco is computed
    if (!data.taco) {
      data.taco = computeTaco(data);
      data.kpi = computeKpi(data);
    }
    res.json(data);
  } catch (err) {
    console.error('Error reading data.json:', err.message);
    res.status(500).json({ error: 'Data unavailable' });
  }
});

// ========== POST /api/update ==========
// Manual partial update — requires Bearer token
app.post('/api/update', (req, res) => {
  // Auth check
  if (UPDATE_TOKEN) {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${UPDATE_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    const body = req.body;

    // Allow updating any data array or field
    const allowedArrays = ['sp500', 'yield10', 'mortgage', 'gas', 'inflate', 'approve', 'months'];
    for (const key of allowedArrays) {
      if (Array.isArray(body[key])) {
        data[key] = body[key];
      }
    }

    // Allow updating baselines
    if (body.baselines && typeof body.baselines === 'object') {
      Object.assign(data.baselines, body.baselines);
    }

    // Allow updating events
    if (Array.isArray(body.chickenEvents)) data.chickenEvents = body.chickenEvents;
    if (Array.isArray(body.timelineEvents)) data.timelineEvents = body.timelineEvents;

    // Allow partial array updates: { "patch": { "gas": { "2026-04": 4.10 } } }
    if (body.patch && typeof body.patch === 'object') {
      for (const [key, monthMap] of Object.entries(body.patch)) {
        if (data[key] && Array.isArray(data[key]) && data.months) {
          for (const [month, value] of Object.entries(monthMap)) {
            const idx = data.months.indexOf(month);
            if (idx !== -1) data[key][idx] = value;
          }
        }
      }
    }

    // Recompute
    data.taco = computeTaco(data);
    data.kpi = computeKpi(data);
    data.lastUpdated = new Date().toISOString();

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true, lastUpdated: data.lastUpdated });
  } catch (err) {
    console.error('Update error:', err.message);
    res.status(500).json({ error: 'Update failed: ' + err.message });
  }
});

// ========== POST /api/fetch — trigger manual fetch ==========
app.post('/api/fetch', async (req, res) => {
  if (UPDATE_TOKEN) {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${UPDATE_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  try {
    const data = await fetchAllData();
    res.json({ success: true, lastUpdated: data ? data.lastUpdated : null });
  } catch (err) {
    res.status(500).json({ error: 'Fetch failed: ' + err.message });
  }
});

// ========== CRON: Daily at 06:00 UTC ==========
cron.schedule('0 6 * * *', async () => {
  console.log('[cron] Running daily data fetch at', new Date().toISOString());
  try {
    await fetchAllData();
    console.log('[cron] Daily fetch complete');
  } catch (err) {
    console.error('[cron] Daily fetch error:', err.message);
  }
}, { timezone: 'UTC' });

// ========== Startup ==========
async function startup() {
  // Ensure taco is computed in existing data
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    if (!data.taco) {
      data.taco = computeTaco(data);
      data.kpi = computeKpi(data);
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
      console.log('[startup] Computed TACO composite for existing data');
    }
  } catch (e) {
    console.error('[startup] data.json read error:', e.message);
  }

  // Try to fetch fresh data (non-blocking — server starts regardless)
  fetchAllData().then(() => {
    console.log('[startup] Initial data fetch complete');
  }).catch(err => {
    console.warn('[startup] Initial data fetch failed (using cached data):', err.message);
  });

  app.listen(PORT, () => {
    console.log(`[TACO] Server running on http://localhost:${PORT}`);
    console.log(`[TACO] Daily auto-fetch scheduled at 06:00 UTC`);
  });
}

startup();

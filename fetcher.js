const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

// ========== Z-Score Helpers ==========
function zScores(arr) {
  const mu = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, v) => a + (v - mu) ** 2, 0) / arr.length) || 1;
  return arr.map(v => (v - mu) / sd);
}

function computeTaco(data) {
  const z_sp = zScores(data.sp500).map(v => -v);
  const z_y  = zScores(data.yield10);
  const z_m  = zScores(data.mortgage);
  const z_g  = zScores(data.gas);
  const z_i  = zScores(data.inflate);
  const z_a  = zScores(data.approve).map(v => -v);

  return data.months.map((_, i) => {
    const raw = z_sp[i] * 0.25 + z_y[i] * 0.15 + z_m[i] * 0.15 +
                z_g[i] * 0.20 + z_i[i] * 0.10 + z_a[i] * 0.15;
    return Math.round(raw * 100) / 100;
  });
}

function computeKpi(data) {
  const base = data.baselines;
  const last = (arr) => arr[arr.length - 1];
  const spLast = last(data.sp500);
  const yLast  = last(data.yield10);
  const mLast  = last(data.mortgage);
  const gLast  = last(data.gas);
  const iLast  = last(data.inflate);
  const aLast  = last(data.approve);

  const spPct = ((spLast - base.sp) / base.sp * 100).toFixed(1);
  const yBp   = Math.round((yLast - base.y) * 100);
  const mBp   = Math.round((mLast - base.m) * 100);
  const gPct  = ((gLast - base.g) / base.g * 100).toFixed(1);
  const iBp   = Math.round((iLast - base.i) * 100);
  const aPp   = (aLast - base.a).toFixed(1);

  return {
    sp500:    { value: spLast, change: (spPct >= 0 ? '+' : '') + spPct + '%', direction: spPct >= 0 ? 'up' : 'down' },
    yield10:  { value: yLast,  change: (yBp >= 0 ? '↑ ' : '↓ ') + Math.abs(yBp) + 'bp', direction: yBp >= 0 ? 'up' : 'down' },
    mortgage: { value: mLast,  change: (mBp >= 0 ? '↑ ' : '↓ ') + Math.abs(mBp) + 'bp', direction: mBp >= 0 ? 'up' : 'down' },
    gas:      { value: gLast,  change: (gPct >= 0 ? '+' : '') + gPct + '%', direction: gPct >= 0 ? 'up' : 'down' },
    inflate:  { value: iLast,  change: (iBp >= 0 ? '+' : '') + iBp + 'bp', direction: iBp >= 0 ? 'up' : 'down' },
    approve:  { value: aLast,  change: (aPp >= 0 ? '↑ ' : '↓ ') + Math.abs(parseFloat(aPp)) + 'pp', direction: parseFloat(aPp) >= 0 ? 'up' : 'down' }
  };
}

// ========== Yahoo Finance Fetcher ==========
async function fetchYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1mo`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    timeout: 15000
  });
  if (!resp.ok) throw new Error(`Yahoo API returned ${resp.status} for ${symbol}`);
  const json = await resp.json();
  const result = json.chart.result[0];
  const timestamps = result.timestamp;
  const closes = result.indicators.quote[0].close;

  // Convert timestamps to YYYY-MM and pair with close prices
  const monthlyData = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    const d = new Date(timestamps[i] * 1000);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    monthlyData.push({ month: key, value: Math.round(closes[i] * 100) / 100 });
  }
  return monthlyData;
}

// ========== FRED Fetcher (requires API key) ==========
// Returns: { status: 'no_key' } | { status: 'error', message: string } | { status: 'ok', data: array }
async function fetchFred(seriesId) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') {
    return { status: 'no_key' };
  }

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=24&frequency=m`;
  try {
    const resp = await fetch(url, { timeout: 15000 });
    if (!resp.ok) {
      return { status: 'error', message: `FRED API returned HTTP ${resp.status} for ${seriesId}` };
    }
    const json = await resp.json();
    const data = json.observations
      .filter(o => o.value !== '.')
      .map(o => ({ month: o.date.slice(0, 7), value: parseFloat(o.value) }))
      .reverse();
    return { status: 'ok', data };
  } catch (err) {
    return { status: 'error', message: `FRED fetch error for ${seriesId}: ${err.message}` };
  }
}

// ========== Merge Helper ==========
// Aligns fetched monthly data into existing data arrays based on month keys
function mergeMonthlyData(existingMonths, existingValues, fetchedData) {
  if (!fetchedData || fetchedData.length === 0) return existingValues;
  const fetchMap = new Map(fetchedData.map(d => [d.month, d.value]));
  const updated = [...existingValues];
  for (let i = 0; i < existingMonths.length; i++) {
    const val = fetchMap.get(existingMonths[i]);
    if (val != null) updated[i] = val;
  }
  return updated;
}

// ========== Main Fetch ==========
async function fetchAllData() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    console.error('Cannot read data.json, aborting fetch:', e.message);
    return null;
  }

  let updated = false;
  const errors = [];

  // 1. S&P 500 from Yahoo
  try {
    console.log('[fetcher] Fetching S&P 500 from Yahoo Finance...');
    const spData = await fetchYahoo('^GSPC');
    if (spData.length > 0) {
      data.sp500 = mergeMonthlyData(data.months, data.sp500, spData.map(d => ({ month: d.month, value: Math.round(d.value) })));
      updated = true;
      console.log('[fetcher] S&P 500 updated:', spData.length, 'months');
    }
  } catch (err) {
    errors.push('S&P 500: ' + err.message);
    console.error('[fetcher] S&P 500 fetch failed:', err.message);
  }

  // 2. 10Y Yield from Yahoo
  try {
    console.log('[fetcher] Fetching 10Y Yield from Yahoo Finance...');
    const yData = await fetchYahoo('^TNX');
    if (yData.length > 0) {
      data.yield10 = mergeMonthlyData(data.months, data.yield10, yData);
      updated = true;
      console.log('[fetcher] 10Y Yield updated:', yData.length, 'months');
    }
  } catch (err) {
    errors.push('10Y Yield: ' + err.message);
    console.error('[fetcher] 10Y Yield fetch failed:', err.message);
  }

  // 3. FRED-based: Mortgage rate (MORTGAGE30US)
  try {
    console.log('[fetcher] Fetching mortgage rate from FRED...');
    const mortgageResult = await fetchFred('MORTGAGE30US');
    if (mortgageResult.status === 'ok') {
      data.mortgage = mergeMonthlyData(data.months, data.mortgage, mortgageResult.data);
      updated = true;
      console.log('[fetcher] Mortgage rate updated:', mortgageResult.data.length, 'months');
    } else if (mortgageResult.status === 'no_key') {
      console.log('[fetcher] Mortgage rate: FRED_API_KEY not set, skipping');
    } else {
      errors.push('Mortgage: ' + mortgageResult.message);
      console.error('[fetcher] Mortgage rate fetch failed:', mortgageResult.message);
    }
  } catch (err) {
    errors.push('Mortgage: ' + err.message);
  }

  // 4. FRED-based: 5Y Breakeven Inflation (T5YIEM)
  try {
    console.log('[fetcher] Fetching 5Y breakeven inflation from FRED...');
    const inflateResult = await fetchFred('T5YIEM');
    if (inflateResult.status === 'ok') {
      data.inflate = mergeMonthlyData(data.months, data.inflate, inflateResult.data);
      updated = true;
      console.log('[fetcher] Breakeven inflation updated:', inflateResult.data.length, 'months');
    } else if (inflateResult.status === 'no_key') {
      console.log('[fetcher] Breakeven inflation: FRED_API_KEY not set, skipping');
    } else {
      errors.push('Inflation: ' + inflateResult.message);
      console.error('[fetcher] Breakeven inflation fetch failed:', inflateResult.message);
    }
  } catch (err) {
    errors.push('Inflation: ' + err.message);
  }

  // 5. Gas and Approval: not auto-fetched — use POST /api/update
  console.log('[fetcher] Gas prices and approval rating: manual update only (POST /api/update)');

  // Recompute TACO composite and KPIs
  data.taco = computeTaco(data);
  data.kpi = computeKpi(data);
  data.lastUpdated = new Date().toISOString();

  // Write back
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log('[fetcher] data.json updated at', data.lastUpdated);
  if (errors.length > 0) {
    console.warn('[fetcher] Errors encountered:', errors);
  }

  return data;
}

module.exports = { fetchAllData, computeTaco, computeKpi };

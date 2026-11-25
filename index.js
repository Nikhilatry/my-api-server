const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Load .env from container root if present (zero extra npm dependencies)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !process.env[key]) {
      process.env[key] = val;
    }
  }
}

const app = express();
app.use(express.json({ limit: '64kb' }));

const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 25590);
const API_KEY = process.env.API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const BASE_PUBLIC_URL = process.env.BASE_PUBLIC_URL || 'https://api.pcmb.qzz.io';

// Bounded in-memory cache (max 500 entries, 60s TTL) to reduce DB SELECT reads
const URL_CACHE_TTL_MS = 60 * 1000;
const URL_CACHE_MAX_ITEMS = 500;
const urlCache = new Map();

function getCachedUrl(slug) {
  const entry = urlCache.get(slug);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    urlCache.delete(slug);
    return null;
  }
  urlCache.delete(slug);
  urlCache.set(slug, entry);
  return entry.targetUrl;
}

function setCachedUrl(slug, targetUrl) {
  if (urlCache.has(slug)) {
    urlCache.delete(slug);
  } else if (urlCache.size >= URL_CACHE_MAX_ITEMS) {
    const oldestKey = urlCache.keys().next().value;
    if (oldestKey) urlCache.delete(oldestKey);
  }
  urlCache.set(slug, {
    targetUrl,
    expiresAt: Date.now() + URL_CACHE_TTL_MS
  });
}


const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invalid URL!</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: radial-gradient(circle at 50% 35%, #ffffff 0%, #f5f7ff 60%, #edf1ff 100%);
      color: #161838;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1.25rem;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      text-align: center;
      overflow: hidden;
    }

    .wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 520px;
      width: 100%;
    }

    .radar {
      width: 164px;
      height: 164px;
      margin-bottom: 1.5rem;
    }

    @keyframes pulseRing {
      0% { transform: scale(0.75); opacity: 0.65; }
      100% { transform: scale(1.22); opacity: 0; }
    }

    @keyframes sweepSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .pulse-ring {
      transform-origin: 82px 82px;
      animation: pulseRing 2.6s ease-out infinite;
    }

    .sweep {
      transform-origin: 82px 82px;
      animation: sweepSpin 4.5s linear infinite;
    }

    h1 {
      font-size: clamp(2.25rem, 6vw, 3.4rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.12;
      margin-bottom: 0.8rem;
    }

    h1 span {
      color: #6b3ef5;
    }

    p {
      font-size: clamp(1rem, 2.4vw, 1.18rem);
      line-height: 1.55;
      color: #565b7d;
      max-width: 420px;
      font-weight: 500;
    }

    @media (prefers-reduced-motion: reduce) {
      .pulse-ring, .sweep { animation: none; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <svg class="radar" viewBox="0 0 164 164" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="82" cy="82" r="56" stroke="#c7cef9" stroke-width="2" stroke-dasharray="5 5" />
      <circle cx="82" cy="82" r="36" stroke="#d5dbfb" stroke-width="2" />
      <circle cx="82" cy="82" r="56" stroke="#7c6cf8" stroke-width="2.5" class="pulse-ring" />

      <g class="sweep">
        <path d="M82 82 L82 26 A56 56 0 0 1 121.6 42.4 Z" fill="rgba(107, 62, 245, 0.14)" />
        <line x1="82" y1="82" x2="82" y2="26" stroke="#6b3ef5" stroke-width="2.2" stroke-linecap="round" />
      </g>

      <circle cx="82" cy="82" r="16" fill="#eef1ff" stroke="#6b3ef5" stroke-width="2.5" />
      <line x1="76.5" y1="76.5" x2="87.5" y2="87.5" stroke="#ef4444" stroke-width="2.6" stroke-linecap="round" />
      <line x1="87.5" y1="76.5" x2="76.5" y2="87.5" stroke="#ef4444" stroke-width="2.6" stroke-linecap="round" />
    </svg>

    <h1>Invalid <span>URL!</span></h1>
    <p>The link you’re looking for doesn’t exist, is expired, or has been removed.</p>
  </main>
</body>
</html>`;
  </style>
</head>
<body>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </svg>
  <h1>Invalid URL</h1>
</body>
</html>`;

// CORS headers for browser/frontend requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

function isValidHttpUrl(raw) {
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function generateSlug(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function sbHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function sbFetch(pathName, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase environment variables are not configured');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(`${SUPABASE_URL}${pathName}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...sbHeaders(),
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

// Root check
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'url-shortener-api',
    host: BASE_PUBLIC_URL,
    timestamp: new Date().toISOString()
  });
});

// Health & memory check
const healthHandler = (req, res) => {
  const mem = process.memoryUsage();
  res.status(200).json({
    status: 'healthy',
    uptimeSec: Math.floor(process.uptime()),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    cachedSlugs: urlCache.size,
    envLoaded: Boolean(SUPABASE_URL && SUPABASE_KEY && API_KEY),
    pid: process.pid
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Create short link (requires Bearer API_KEY)
app.post('/api/shorten', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (!API_KEY || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const targetUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!isValidHttpUrl(targetUrl)) {
    return res.status(400).json({ error: 'Invalid http/https URL' });
  }

  let slug = typeof req.body?.slug === 'string' && req.body.slug.trim()
    ? req.body.slug.trim()
    : generateSlug(6);

  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(slug) || ['api', 'health'].includes(slug.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid or reserved slug (use 3-24 letters, numbers, -, _)' });
  }

  try {
    const response = await sbFetch('/rest/v1/short_links', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ slug, target_url: targetUrl }])
    });

    if (response.status === 409) {
      return res.status(409).json({ error: 'Slug already exists' });
    }
    if (!response.ok) {
      const errText = await response.text();
      console.error('[Supabase Insert Error]:', response.status, errText);
      return res.status(502).json({ error: 'Database insert failed' });
    }

    const rows = await response.json();
    const created = rows[0] || { slug, target_url: targetUrl };
    setCachedUrl(created.slug, created.target_url);

    return res.status(201).json({
      slug: created.slug,
      shortUrl: `${BASE_PUBLIC_URL}/${created.slug}`,
      targetUrl: created.target_url
    });
  } catch (err) {
    console.error('[POST /api/shorten]:', err.message);
    return res.status(500).json({ error: 'Failed to create short link' });
  }
});

// Link stats endpoint
app.get('/api/stats/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug format' });
  }

  try {
    const query = `/rest/v1/short_links?slug=eq.${encodeURIComponent(slug)}&select=slug,target_url,clicks,created_at,last_clicked_at&limit=1`;
    const response = await sbFetch(query, { method: 'GET' });
    if (!response.ok) {
      return res.status(502).json({ error: 'Database lookup failed' });
    }
    const rows = await response.json();
    if (!rows.length) {
      return res.status(404).json({ error: 'Short link not found' });
    }
    const row = rows[0];
    return res.status(200).json({
      slug: row.slug,
      targetUrl: row.target_url,
      clicks: row.clicks,
      createdAt: row.created_at,
      lastClickedAt: row.last_clicked_at
    });
  } catch (err) {
    console.error('[GET /api/stats/:slug]:', err.message);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Redirect endpoint + click increment
app.get('/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(slug)) {
    return res.status(404).type('html').send(NOT_FOUND_HTML);
  }

  try {
    let targetUrl = getCachedUrl(slug);

    if (!targetUrl) {
      const query = `/rest/v1/short_links?slug=eq.${encodeURIComponent(slug)}&select=target_url&limit=1`;
      const response = await sbFetch(query, { method: 'GET' });
      if (!response.ok) {
        return res.status(502).json({ error: 'Database lookup failed' });
      }
      const rows = await response.json();
      if (!rows.length || !isValidHttpUrl(rows[0].target_url)) {
        return res.status(404).type('html').send(NOT_FOUND_HTML);
      }
      targetUrl = rows[0].target_url;
      setCachedUrl(slug, targetUrl);
    }

    sbFetch('/rest/v1/rpc/increment_link_click', {
      method: 'POST',
      body: JSON.stringify({ p_slug: slug })
    }).catch((err) => console.error('[Click Increment Error]:', err.message));

    return res.redirect(302, targetUrl);
  } catch (err) {
    console.error('[GET /:slug]:', err.message);
    return res.status(500).json({ error: 'Redirect failed' });
  }
});

// 404 fallback
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'Not Found',
      path: req.originalUrl
    });
  }
  return res.status(404).type('html').send(NOT_FOUND_HTML);
});

// Global Express error handler
app.use((err, req, res, next) => {
  console.error('[Express Error]:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]:', reason);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`URL Shortener API listening on 0.0.0.0:${PORT}`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

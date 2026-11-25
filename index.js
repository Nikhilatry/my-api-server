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
    let val = trimmed.slice(idx + 1).trim();
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
const HOME_PAGE_URL = process.env.HOME_PAGE_URL || 'https://pcmb.qzz.io';

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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderNotFoundHtml(slugOrPath) {
  const safeSlug = escapeHtml(slugOrPath);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>404 — Short Link Not Found</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    body {
      background: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 14px;
      padding: 2.25rem 1.75rem;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 35px rgba(0, 0, 0, 0.35);
    }
    .code {
      display: inline-block;
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #fca5a5;
      background: rgba(239, 68, 68, 0.14);
      border: 1px solid rgba(239, 68, 68, 0.35);
      padding: 0.3rem 0.75rem;
      border-radius: 999px;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.6rem;
    }
    p {
      color: #94a3b8;
      font-size: 0.95rem;
      line-height: 1.55;
      margin-bottom: 1.25rem;
    }
    .slug-box {
      background: #0f172a;
      border: 1px solid #334155;
      color: #38bdf8;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.88rem;
      padding: 0.55rem 0.8rem;
      border-radius: 8px;
      margin-bottom: 1.5rem;
      word-break: break-all;
    }
    .actions {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    a.btn {
      text-decoration: none;
      padding: 0.65rem 1.15rem;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      transition: opacity 0.15s;
    }
    a.btn-primary {
      background: #38bdf8;
      color: #0f172a;
    }
    a.btn-secondary {
      background: transparent;
      color: #f8fafc;
      border: 1px solid #334155;
    }
    a.btn:hover { opacity: 0.88; }
  </style>
</head>
<body>
  <div class="card">
    <span class="code">ERROR 404</span>
    <h1>Short Link Not Found</h1>
    <p>The short URL you tried to open does not exist, may have been typed incorrectly, or has been removed.</p>
    <div class="slug-box">${escapeHtml(BASE_PUBLIC_URL)}/${safeSlug}</div>
    <div class="actions">
      <a class="btn btn-primary" href="${escapeHtml(HOME_PAGE_URL)}">Go to Homepage</a>
      <a class="btn btn-secondary" href="javascript:history.back()">Go Back</a>
    </div>
  </div>
</body>
</html>`;
}

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

// Redirect endpoint + click increment (renders HTML 404 page if slug not found)
app.get('/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(slug)) {
    return res.status(404).type('html').send(renderNotFoundHtml(slug));
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
        return res.status(404).type('html').send(renderNotFoundHtml(slug));
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

// 404 fallback (JSON for /api/*, HTML page for browser paths)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'Not Found',
      path: req.originalUrl
    });
  }
  const cleanPath = req.path.replace(/^\/+/, '');
  return res.status(404).type('html').send(renderNotFoundHtml(cleanPath));
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

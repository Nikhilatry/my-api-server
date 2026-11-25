const express = require('express');
const app = express();

// Keep memory usage light and reject oversized bodies early
app.use(express.json({ limit: '256kb' }));

// Basic CORS headers for browser/frontend requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Root route
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'my-api-server',
    host: 'nikhil.app.vertos.in',
    timestamp: new Date().toISOString()
  });
});

// Health check on both /health and /api/health
const healthHandler = (req, res) => {
  const mem = process.memoryUsage();
  res.status(200).json({
    status: 'healthy',
    uptimeSec: Math.floor(process.uptime()),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    pid: process.pid
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Echo test endpoint
app.post('/api/echo', (req, res) => {
  res.status(200).json({
    ok: true,
    received: req.body ?? null,
    timestamp: new Date().toISOString()
  });
});

// 404 fallback for unknown paths
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.originalUrl
  });
});

// Global Express error handler
app.use((err, req, res, next) => {
  console.error('[Express Error]:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Prevent unhandled errors from silently killing the container without a log
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]:', reason);
});

const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 25590);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
  console.log(`Env check -> SERVER_PORT=${process.env.SERVER_PORT || 'unset'}, PORT=${process.env.PORT || 'unset'}`);
});

// Keep-alive & header timeouts tuned for reverse proxies like OpenResty
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

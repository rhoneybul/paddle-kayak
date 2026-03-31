require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const tripsRouter       = require('./routes/trips');
const paddlesRouter     = require('./routes/paddles');
const campsitesRouter   = require('./routes/campsites');
const weatherRouter     = require('./routes/weather');
const usersRouter       = require('./routes/users');
const planningRouter    = require('./routes/planning');
const savedRoutesRouter = require('./routes/savedRoutes');
const poisRouter        = require('./routes/pois');

const { authMiddleware } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS;
app.use(cors({ origin: !allowedOrigins || allowedOrigins === '*' ? '*' : allowedOrigins.split(',') }));
app.use(express.json());

// ── Health check (no auth needed) ────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ── Protected routes ──────────────────────────────────────────────────────────
app.use('/api/users',         authMiddleware, usersRouter);
app.use('/api/trips',         authMiddleware, tripsRouter);
app.use('/api/paddles',       authMiddleware, paddlesRouter);
app.use('/api/saved-routes',  authMiddleware, savedRoutesRouter);
app.use('/api/campsites', campsitesRouter);  // public — no auth needed
app.use('/api/weather',   weatherRouter);    // public — proxies Open-Meteo
app.use('/api/planning',  planningRouter);   // public — plans paddles via Claude
app.use('/api/pois',     poisRouter);      // public — POI search via Overpass

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Solvaa API running on http://localhost:${PORT}`);
});

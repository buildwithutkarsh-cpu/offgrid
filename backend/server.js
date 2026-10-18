const { createHmac, timingSafeEqual } = require('node:crypto');
const cors = require('cors');
const express = require('express');
const { rateLimit } = require('express-rate-limit');

const app = express();
const port = Number(process.env.PORT) || 3000;
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.ADMIN_SESSION_SECRET;
const sessionCookie = 'offgrid_admin';
const sessionDurationMs = 8 * 60 * 60 * 1000;

const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5500')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '10kb' }));

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signSession(expiry) {
  return createHmac('sha256', sessionSecret).update(expiry).digest('base64url');
}

function getSessionToken(req) {
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`));
  return cookie?.slice(sessionCookie.length + 1);
}

function hasAdminSession(req) {
  if (!sessionSecret) return false;
  const [expiry, signature, extra] = (getSessionToken(req) || '').split('.');
  if (!expiry || !signature || extra || !/^\d+$/.test(expiry) || Number(expiry) <= Date.now()) {
    return false;
  }

  return safeEqual(signature, signSession(expiry));
}

function setSessionCookie(res, value, maxAge) {
  res.cookie(sessionCookie, value, {
    httpOnly: true,
    secure: res.req.secure,
    sameSite: res.req.secure ? 'none' : 'strict',
    path: '/',
    maxAge,
  });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

app.get('/', (_req, res) => {
  res.json({ name: 'OffGrid Delhi API', status: 'ok' });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  if (!adminPassword || !sessionSecret) {
    return res.status(503).json({ error: 'Admin login is not configured on the server.' });
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeEqual(password, adminPassword)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  const expiry = String(Date.now() + sessionDurationMs);
  setSessionCookie(res, `${expiry}.${signSession(expiry)}`, sessionDurationMs);
  return res.json({ authenticated: true });
});

app.get('/api/admin/session', (req, res) => {
  if (!hasAdminSession(req)) return res.status(401).json({ error: 'Not authenticated.' });
  return res.json({ authenticated: true, expiresInMs: sessionDurationMs });
});

app.post('/api/admin/logout', (_req, res) => {
  setSessionCookie(res, '', 0);
  return res.status(204).end();
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`OffGrid Delhi API listening on port ${port}`);
});
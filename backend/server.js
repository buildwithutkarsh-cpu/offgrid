const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const cors = require('cors');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const mongoose = require('mongoose');
const Puzzle = require('./models/Puzzle');
const PuzzleProgress = require('./models/PuzzleProgress');

const app = express();
const port = Number(process.env.PORT) || 3000;
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.ADMIN_SESSION_SECRET;
const sessionCookie = 'offgrid_admin';
const sessionDurationMs = 8 * 60 * 60 * 1000;
const registrationOpensAt = Date.parse('2026-11-01T00:00:00+05:30');
const registrationPreviewEnabled = process.env.REGISTRATION_PREVIEW_ENABLED === 'true';
const registrationSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  isPreview: { type: Boolean, default: false, required: true },
  participantName: { type: String, required: true, trim: true, maxlength: 100 },
  participantAge: { type: Number, required: true, min: 1, max: 17 },
  guardianName: { type: String, required: true, trim: true, maxlength: 100 },
  guardianEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  guardianPhone: { type: String, required: true, trim: true, maxlength: 30 },
  guardianConsent: { type: Boolean, required: true, validate: (value) => value === true },
}, { timestamps: true });
const Registration = mongoose.model('Registration', registrationSchema);

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
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' },
});
const puzzleAnswerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many answer attempts. Please try again later.' },
});

function requireAdmin(req, res, next) {
  if (!hasAdminSession(req)) return res.status(401).json({ error: 'Not authenticated.' });
  return next();
}

function getRoundDay(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const localDate = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const firstRoundDate = Date.UTC(2026, 10, 1);
  const day = Math.floor((localDate - firstRoundDate) / 86400000) + 1;

  if (day < 1) return { state: 'upcoming', day: null };
  if (day > 7) return { state: 'closed', day: null };
  return { state: 'open', day };
}

function normalizeAnswer(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

app.get('/', (_req, res) => {
  res.json({ name: 'OffGrid Delhi API', status: 'ok' });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.get('/api/puzzles/today', async (req, res) => {
  const round = getRoundDay();
  if (round.state === 'upcoming') {
    return res.status(403).json({ error: 'The online puzzle round opens on 1 November 2026 at 12:00 AM IST.' });
  }
  if (round.state === 'closed') return res.status(410).json({ error: 'The online puzzle round has ended.' });

  const ticketCode = typeof req.query.ticketCode === 'string' ? req.query.ticketCode.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{5}$/.test(ticketCode)) {
    return res.status(400).json({ error: 'Enter your five-character ticket code.' });
  }

  try {
    const puzzle = await Puzzle.findOne({ day: round.day, ticketCode }).select('-answer').lean();
    if (!puzzle) return res.status(404).json({ error: 'No puzzle was found for that ticket today. Check the code and try again.' });
    const progress = await PuzzleProgress.findOne({ day: round.day, ticketCode }).lean();
    return res.json({
      day: puzzle.day,
      puzzleType: puzzle.puzzleType,
      question: puzzle.question,
      cipherText: puzzle.cipherText,
      hints: [puzzle.hint1, puzzle.hint2],
      solved: Boolean(progress?.solvedAt),
      attempts: progress?.attempts || 0,
    });
  } catch (error) {
    console.error('Unable to load puzzle:', error.message);
    return res.status(503).json({ error: 'The puzzle service is temporarily unavailable.' });
  }
});

app.post('/api/registrations', registrationLimiter, async (req, res) => {
  const isPreview = req.body?.preview === true;
  if (isPreview && !registrationPreviewEnabled) {
    return res.status(403).json({ error: 'Preview submissions are not enabled on the server.' });
  }
  if (Date.now() < registrationOpensAt && !isPreview) {
    return res.status(403).json({ error: 'Registration opens on 1 November 2026 at 12:00 AM IST.' });
  }

  const {
    participantName,
    participantAge,
    guardianName,
    guardianEmail,
    guardianPhone,
    guardianConsent,
  } = req.body || {};
  const normalizedAge = Number(participantAge);

  if (typeof participantName !== 'string' || participantName.trim().length < 2 || participantName.trim().length > 100
    || !Number.isInteger(normalizedAge) || normalizedAge < 1 || normalizedAge > 17
    || typeof guardianName !== 'string' || guardianName.trim().length < 2 || guardianName.trim().length > 100
    || typeof guardianEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardianEmail.trim())
    || guardianEmail.trim().length > 254
    || typeof guardianPhone !== 'string' || guardianPhone.trim().length < 7 || guardianPhone.trim().length > 30
    || guardianConsent !== true) {
    return res.status(400).json({ error: 'Enter valid participant and guardian details, and confirm guardian consent.' });
  }

  try {
    const registration = await Registration.create({
      code: `OG-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
      isPreview,
      participantName,
      participantAge: normalizedAge,
      guardianName,
      guardianEmail,
      guardianPhone,
      guardianConsent,
    });
    return res.status(201).json({ message: 'Registration received.', code: registration.code });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Please check the registration details and try again.' });
    }
    console.error('Unable to save registration:', error.message);
    return res.status(503).json({ error: 'Registration is temporarily unavailable. Please try again later.' });
  }
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

app.get('/api/admin/session', requireAdmin, (_req, res) => {
  return res.json({ authenticated: true, expiresInMs: sessionDurationMs });
});

app.get('/api/admin/registrations', requireAdmin, async (_req, res) => {
  try {
    const registrations = await Registration.find()
      .sort({ createdAt: -1 })
      .limit(500)
      .select('code isPreview participantName participantAge guardianName guardianEmail guardianPhone createdAt')
      .lean();
    return res.json(registrations);
  } catch (error) {
    console.error('Unable to load registrations:', error.message);
    return res.status(503).json({ error: 'Registrations are temporarily unavailable.' });
  }
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

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI);
  app.listen(port, '0.0.0.0', () => {
    console.log(`OffGrid Delhi API listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Unable to start OffGrid Delhi API:', error.message);
  process.exit(1);
});

app.post('/api/puzzles/answer', puzzleAnswerLimiter, async (req, res) => {
  const round = getRoundDay();
  if (round.state === 'upcoming') {
    return res.status(403).json({ error: 'The online puzzle round opens on 1 November 2026 at 12:00 AM IST.' });
  }
  if (round.state === 'closed') return res.status(410).json({ error: 'The online puzzle round has ended.' });

  const ticketCode = typeof req.body?.ticketCode === 'string' ? req.body.ticketCode.trim().toUpperCase() : '';
  const answer = typeof req.body?.answer === 'string' ? normalizeAnswer(req.body.answer.trim()) : '';
  if (!/^[A-Z0-9]{5}$/.test(ticketCode) || !answer || answer.length > 100) {
    return res.status(400).json({ error: 'Enter your five-character ticket code and an answer.' });
  }

  try {
    const puzzle = await Puzzle.findOne({ day: round.day, ticketCode }).select('+answer').lean();
    if (!puzzle) return res.status(404).json({ error: 'No puzzle was found for that ticket today. Check the code and try again.' });
    const progress = await PuzzleProgress.findOne({ day: round.day, ticketCode }).lean();
    if (progress?.solvedAt) return res.json({ correct: true, solved: true, attempts: progress.attempts });

    const correct = normalizeAnswer(puzzle.answer) === answer;
    const updatedProgress = await PuzzleProgress.findOneAndUpdate(
      { day: round.day, ticketCode },
      {
        $inc: { attempts: 1 },
        $setOnInsert: { day: round.day, ticketCode },
        ...(correct ? { $set: { solvedAt: new Date() } } : {}),
      },
      { upsert: true, new: true, runValidators: true },
    ).lean();
    return res.json({
      correct,
      solved: correct,
      attempts: updatedProgress.attempts,
      message: correct ? 'Correct. The signal is yours.' : 'Not quite. Recheck the cipher and try again.',
    });
  } catch (error) {
    console.error('Unable to check puzzle answer:', error.message);
    return res.status(503).json({ error: 'Answer checking is temporarily unavailable.' });
  }
});
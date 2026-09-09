import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDB, getDB } from './db/index.js';
import { seedDatabase } from './db/seed.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import bakerRoutes from './routes/baker.js';
import mobileRoutes from './routes/mobile.js';
import subscriptionRoutes from './routes/subscriptions.js';
import organizationRoutes from './routes/organization.js';
import onboardingRoutes from './routes/onboarding.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || '3000');

const startServer = (port: number) => {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Bakery Web App server running on port ${port}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`Port ${port} is in use. Retrying on port ${nextPort}...`);
      startServer(nextPort);
      return;
    }

    console.error('Failed to start the server:', err);
    process.exit(1);
  });
};

const configuredFrontendUrl = process.env.FRONTEND_URL;
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || !configuredFrontendUrl || origin === configuredFrontendUrl || /^https?:\/\/localhost(?::\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin denied'));
  },
  credentials: true,
}));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' http://localhost:* https:; font-src 'self' data:; frame-ancestors 'self'");
  next();
});
app.use(express.json());

const authAttempts = new Map<string, { count: number; resetAt: number }>();
const authRateLimit: express.RequestHandler = (req, res, next) => {
  const key = req.ip || 'unknown';
  const current = authAttempts.get(key);
  const now = Date.now();
  if (!current || current.resetAt <= now) authAttempts.set(key, { count: 1, resetAt: now + 60_000 });
  else if (current.count >= 30) { res.status(429).json({ error: 'Too many authentication attempts' }); return; }
  else current.count += 1;
  next();
};

// Initialize database
initDB();

// Seed only an empty database. Never replace existing user data automatically.
try {
  const db = getDB();
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
  if (userCount.count === 0) {
    console.log('Empty database detected — running auto-seed...');
    seedDatabase();
    console.log('Database seeded successfully on startup.');
  } else {
    console.log(`Database has ${userCount.count} users — skipping seed.`);
  }
} catch (err) {
  console.error('Auto-seed check failed:', err);
}

// Health check (before auth middleware)
app.get('/api/health', (_req: express.Request, res: express.Response) => {
  try {
    const db = getDB();
    db.prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      database: 'ok',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Health check failed:', err);
    res.status(503).json({ status: 'unhealthy', database: 'unavailable', timestamp: new Date().toISOString() });
  }
});
app.get('/health', (_req, res) => {
  try { getDB().prepare('SELECT 1').get(); res.json({ status: 'ok', database: 'ok', timestamp: new Date().toISOString() }); }
  catch { res.status(503).json({ status: 'unhealthy', database: 'unavailable', timestamp: new Date().toISOString() }); }
});

// API routes
app.use('/api/auth', authRateLimit, authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/baker', bakerRoutes);
app.use('/api/mobile', mobileRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/onboarding', onboardingRoutes);

// Serve static client in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// SPA fallback — ONLY for non-API routes
app.get('*', (req: express.Request, res: express.Response) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  const indexPath = path.join(clientDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(500).json({
      error: 'Client build not found',
      expected: indexPath,
      cwd: process.cwd(),
      dirname: __dirname,
    });
  }
});

// Error handler (MUST have 4 params for Express to recognize it)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err);
  const status = err.status || 500;
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : (err.message || 'Request failed') });
});

startServer(PORT);

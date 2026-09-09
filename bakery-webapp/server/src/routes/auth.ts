import { Router } from 'express';
import bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDB, getBakeryForUser, getOrganizationForUser, getLocationForUser, getLocationsForUser, getPermissionsForUser, recordAudit } from '../db/index.js';
import { authMiddleware, generateToken, AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/rbac.js';

const router = Router();
const db = getDB();

// POST /api/auth/register
router.post('/register', (req: any, res: any) => {
  try {
    const { email, password, name, bakeryName, phone } = req.body;

    if (!email || !password || !name || !bakeryName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const userId = uuidv4();
    let organizationId = '';
    let locationId = '';
    const hashedPassword = bcryptjs.hashSync(password, 10);
    const now = new Date().toISOString();

    // Start transaction
    const transaction = db.transaction(() => {
      // Create user
      db.prepare(`
        INSERT INTO users (id, email, password, name, role, phone, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, email, hashedPassword, name, 'baker', phone || null, now);

      organizationId = uuidv4();
      const organizationSlug = `${bakeryName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-${userId.slice(0, 8)}`;
      db.prepare(`
        INSERT INTO organizations (id, name, slug, country, currency, timezone, locale, measurement_system, tax_model, onboarding_status, onboarding_completed, onboarding_step, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', 0, 1, ?, ?)
      `).run(organizationId, bakeryName, organizationSlug, 'US', 'USD', 'America/New_York', 'en-US', 'imperial', 'none', now, now);

      // Create bakery
      const bakeryId = uuidv4();
      const slug = bakeryName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');

      db.prepare(`
        INSERT INTO bakeries (id, owner_id, name, slug, phone, tier, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(bakeryId, userId, bakeryName, slug, phone || null, 'free', 'active', now, now);

      db.prepare('UPDATE bakeries SET organization_id = ? WHERE id = ?').run(organizationId, bakeryId);
      locationId = uuidv4();
      db.prepare(`
        INSERT INTO locations (id, organization_id, name, code, country, is_default, created_at, updated_at)
        VALUES (?, ?, ?, 'main', 'US', 1, ?, ?)
      `).run(locationId, organizationId, `${bakeryName} - Main`, now, now);
      db.prepare('UPDATE users SET organization_id = ?, default_location_id = ? WHERE id = ?').run(organizationId, locationId, userId);
      db.prepare(`
        INSERT INTO user_organizations (id, user_id, organization_id, location_id, role, created_at)
        VALUES (?, ?, ?, ?, 'owner', ?)
      `).run(uuidv4(), userId, organizationId, locationId, now);

      // Create subscription
      const subscriptionId = uuidv4();
      db.prepare(`
        INSERT INTO subscriptions (id, bakery_id, tier, status, monthly_price, started_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(subscriptionId, bakeryId, 'free', 'active', 0, now, now);

      // Create default onboarding steps
      const steps = [
        'profile_setup',
        'add_products',
        'add_Customers',
        'create_first_order',
        'team_setup',
      ];
      for (const step of steps) {
        db.prepare(`
          INSERT INTO onboarding_steps (id, bakery_id, step, completed)
          VALUES (?, ?, ?, ?)
        `).run(uuidv4(), bakeryId, step, 0);
      }
    });

    transaction();
    recordAudit(userId, 'registration.completed', organizationId, locationId, 'organization', organizationId);

    const token = generateToken(userId, email, name, 'baker');
    const bakery = getBakeryForUser(userId);

    res.status(201).json({
      token,
      user: { id: userId, email, name, role: 'baker' },
      bakery,
      organization: getOrganizationForUser(userId),
      location: getLocationForUser(userId),
      locations: getLocationsForUser(userId),
      permissions: getPermissionsForUser(userId),
    });
  } catch (err: any) {
    console.error('Register error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', (req: any, res: any) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = bcryptjs.compareSync(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id);

    const token = generateToken(user.id, user.email, user.name, user.role);
    recordAudit(user.id, 'auth.login', user.organization_id, user.default_location_id, 'user', user.id);

    let bakery = null;
    if (user.role === 'baker') {
      bakery = getBakeryForUser(user.id);
    }
    const organization = getOrganizationForUser(user.id);
    const location = getLocationForUser(user.id, organization?.location_id);

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      bakery,
      organization,
      location,
      locations: getLocationsForUser(user.id),
      permissions: getPermissionsForUser(user.id),
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, requireAuth, (req: AuthRequest, res: any) => {
  try {
    const user = db.prepare('SELECT id, email, name, role, phone, avatar_url FROM users WHERE id = ?').get(
      req.user!.id
    ) as any;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let bakery = null;
    if (user.role === 'baker') {
      bakery = getBakeryForUser(user.id);
    }
    const organization = getOrganizationForUser(user.id);
    const location = getLocationForUser(user.id, organization?.location_id);

    res.json({
      user,
      bakery,
      organization,
      location,
      locations: getLocationsForUser(user.id),
      permissions: getPermissionsForUser(user.id),
    });
  } catch (err: any) {
    console.error('Me error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

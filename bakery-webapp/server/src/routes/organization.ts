import { Router } from 'express';
import bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import {
  getDB,
  getLocationsForUser,
  getOrganizationForUser,
  getPermissionsForUser,
  canAccessLocation,
  recordAudit,
} from '../db/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { requireAuth, requirePermission } from '../middleware/rbac.js';

const router = Router();
const db = getDB();

const staffRoles = [
  'owner',
  'manager',
  'baker',
  'cashier',
  'inventory_manager',
  'accountant',
  'marketing_manager',
  'staff',
];

router.use(authMiddleware, requireAuth);

/**
 * Organization context
 */
router.get('/context', (req: AuthRequest, res) => {
  const organization = getOrganizationForUser(req.user!.id);

  res.json({
    organization,
    locations: getLocationsForUser(req.user!.id),
    permissions: getPermissionsForUser(req.user!.id),
    role: organization?.role || req.user!.role,
  });
});

/**
 * List authorized locations
 */
router.get(
  '/locations',
  requirePermission('locations.view'),
  (req: AuthRequest, res) => {
    res.json({
      locations: getLocationsForUser(req.user!.id),
    });
  }
);

/**
 * Create location
 */
router.post(
  '/locations',
  requirePermission('locations.manage'),
  (req: AuthRequest, res) => {
    const organization = getOrganizationForUser(req.user!.id);

    if (!organization) {
      return res.status(400).json({
        error: 'Organization not found',
      });
    }

    const {
      name,
      code,
      address,
      addressLine1,
      addressLine2,
      country,
      stateProvince,
      city,
      postalCode,
      phone,
      timezone,
      currency,
    } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        error: 'Location name and code are required',
      });
    }

    const now = new Date().toISOString();
    const id = uuidv4();

    try {
      db.prepare(`
        INSERT INTO locations (
          id,
          organization_id,
          name,
          code,
          address,
          address_line1,
          address_line2,
          country,
          state_province,
          city,
          postal_code,
          phone,
          timezone,
          currency,
          is_default,
          is_active,
          created_at,
          updated_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?
        )
      `).run(
        id,
        organization.id,
        name,
        code,
        address || addressLine1 || null,
        addressLine1 || address || null,
        addressLine2 || null,
        country || organization.country,
        stateProvince || organization.state_province,
        city || organization.city,
        postalCode || organization.postal_code,
        phone || null,
        timezone || organization.timezone,
        currency || null,
        now,
        now
      );

      const createdLocation = db
        .prepare('SELECT * FROM locations WHERE id = ?')
        .get(id);

      recordAudit(
        req.user!.id,
        'location.created',
        organization.id,
        id,
        'location',
        id,
        { name, code }
      );

      return res.status(201).json(createdLocation);
    } catch (err: any) {
      return res.status(409).json({
        error: err.message,
      });
    }
  }
);

/**
 * Update location
 */
router.put(
  '/locations/:id',
  requirePermission('locations.manage'),
  (req: AuthRequest, res) => {
    const organization = getOrganizationForUser(req.user!.id);

    if (!organization) {
      return res.status(400).json({
        error: 'Organization not found',
      });
    }

    const locationId =
      typeof req.params.id === 'string' ? req.params.id : req.params.id[0];

    const location = db
      .prepare(
        'SELECT * FROM locations WHERE id = ? AND organization_id = ?'
      )
      .get(locationId, organization.id) as any;

    if (!location) {
      return res.status(404).json({
        error: 'Location not found',
      });
    }

    const fields: Record<string, string> = {
      name: 'name',
      code: 'code',
      address: 'address',
      addressLine1: 'address_line1',
      addressLine2: 'address_line2',
      country: 'country',
      stateProvince: 'state_province',
      city: 'city',
      postalCode: 'postal_code',
      phone: 'phone',
      timezone: 'timezone',
      currency: 'currency',
      isActive: 'is_active',
    };

    const updates: string[] = [];
    const values: any[] = [];

    for (const [input, column] of Object.entries(fields)) {
      if (req.body[input] !== undefined) {
        updates.push(`${column} = ?`);
        values.push(req.body[input]);
      }
    }

    if (!updates.length) {
      return res.json(location);
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());

    values.push(location.id);
    values.push(organization.id);

    try {
      db.prepare(`
        UPDATE locations
        SET ${updates.join(', ')}
        WHERE id = ? AND organization_id = ?
      `).run(...values);

      const updatedLocation = db
        .prepare('SELECT * FROM locations WHERE id = ?')
        .get(location.id);

      recordAudit(
        req.user!.id,
        'location.updated',
        organization.id,
        location.id,
        'location',
        location.id
      );

      return res.json(updatedLocation);
    } catch (err: any) {
      return res.status(409).json({
        error: err.message,
      });
    }
  }
);

/**
 * Switch active location
 */
router.post('/active-location', (req: AuthRequest, res) => {
  const { locationId } = req.body;

  if (
    !locationId ||
    typeof locationId !== 'string' ||
    !canAccessLocation(req.user!.id, locationId)
  ) {
    return res.status(403).json({
      error: 'Location access denied',
    });
  }

  db.prepare(`
    UPDATE user_organizations
    SET location_id = ?
    WHERE user_id = ? AND is_active = 1
  `).run(locationId, req.user!.id);

  const organization = getOrganizationForUser(req.user!.id);

  recordAudit(
    req.user!.id,
    'location.switched',
    organization?.id,
    locationId,
    'location',
    locationId
  );

  const activeLocation = getLocationsForUser(req.user!.id).find(
    (item) => item.id === locationId
  );

  return res.json({
    organization: getOrganizationForUser(req.user!.id),
    location: activeLocation,
  });
});

/**
 * List organization staff
 */
router.get(
  '/staff',
  requirePermission('staff.view'),
  (req: AuthRequest, res) => {
    const organization = getOrganizationForUser(req.user!.id);

    if (!organization) {
      return res.status(400).json({
        error: 'Organization not found',
      });
    }

    const staff = db
      .prepare(`
        SELECT
          u.id,
          u.email,
          u.name,
          u.phone,
          u.created_at,
          uo.role,
          uo.location_id,
          uo.is_active
        FROM users u
        JOIN user_organizations uo
          ON uo.user_id = u.id
        WHERE uo.organization_id = ?
        ORDER BY u.name
      `)
      .all(organization.id);

    return res.json({
      staff,
    });
  }
);

/**
 * Create organization staff member
 */
router.post(
  '/staff',
  requirePermission('staff.manage'),
  (req: AuthRequest, res) => {
    const organization = getOrganizationForUser(req.user!.id);

    const {
      name,
      email,
      password,
      phone,
      role = 'staff',
      locationIds = [],
    } = req.body;

    if (!organization || !name || !email || !password) {
      return res.status(400).json({
        error: 'Name, email, and password are required',
      });
    }

    if (
      !staffRoles.includes(role) ||
      role === 'platform_admin'
    ) {
      return res.status(400).json({
        error: 'Invalid organization role',
      });
    }

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({
        error: 'Email already registered',
      });
    }

    const requestedLocationIds = Array.isArray(locationIds)
      ? locationIds
      : [];

    const validLocations = getLocationsForUser(req.user!.id).filter(
      (location) => requestedLocationIds.includes(location.id)
    );

    const now = new Date().toISOString();
    const userId = uuidv4();
    const membershipId = uuidv4();

    const locationId =
      validLocations[0]?.id ||
      organization.location_id ||
      null;

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO users (
          id,
          email,
          password,
          name,
          role,
          phone,
          phone_e164,
          organization_id,
          default_location_id,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        email,
        bcryptjs.hashSync(password, 10),
        name,
        'baker',
        phone || null,
        phone || null,
        organization.id,
        locationId,
        now
      );

      db.prepare(`
        INSERT INTO user_organizations (
          id,
          user_id,
          organization_id,
          location_id,
          role,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        membershipId,
        userId,
        organization.id,
        locationId,
        role,
        now
      );

      for (const location of validLocations) {
        db.prepare(`
          INSERT OR IGNORE INTO membership_locations (
            membership_id,
            location_id,
            created_at
          )
          VALUES (?, ?, ?)
        `).run(
          membershipId,
          location.id,
          now
        );
      }
    });

    transaction();

    recordAudit(
      req.user!.id,
      'staff.created',
      organization.id,
      locationId || undefined,
      'user',
      userId,
      { role }
    );

    return res.status(201).json({
      id: userId,
      email,
      name,
      role,
      locationIds: validLocations.map(
        (location) => location.id
      ),
    });
  }
);

/**
 * Update organization staff member
 */
router.put(
  '/staff/:userId',
  requirePermission('staff.manage'),
  (req: AuthRequest, res) => {
    const organization = getOrganizationForUser(req.user!.id);

    if (!organization) {
      return res.status(400).json({
        error: 'Organization not found',
      });
    }

    /**
     * Express route params can be typed as string | string[].
     * We explicitly normalize it to a string.
     */
    const userId =
      typeof req.params.userId === 'string'
        ? req.params.userId
        : req.params.userId[0];

    const member = db
      .prepare(`
        SELECT *
        FROM user_organizations
        WHERE user_id = ?
          AND organization_id = ?
      `)
      .get(userId, organization.id) as any;

    if (!member) {
      return res.status(404).json({
        error: 'Staff member not found',
      });
    }

    const {
      role,
      locationIds,
      isActive,
    } = req.body;

    /**
     * Validate role
     */
    if (
      role !== undefined &&
      (!staffRoles.includes(role) ||
        role === 'platform_admin')
    ) {
      return res.status(400).json({
        error: 'Invalid organization role',
      });
    }

    const now = new Date().toISOString();

    /**
     * Update role / active state
     */
    if (
      role !== undefined ||
      isActive !== undefined
    ) {
      db.prepare(`
        UPDATE user_organizations
        SET
          role = COALESCE(?, role),
          is_active = COALESCE(?, is_active)
        WHERE id = ?
      `).run(
        role ?? null,
        isActive === undefined
          ? null
          : isActive
            ? 1
            : 0,
        member.id
      );
    }

    /**
     * Update authorized locations
     */
    if (Array.isArray(locationIds)) {
      const allowedLocations =
        getLocationsForUser(req.user!.id).filter(
          (location) =>
            locationIds.includes(location.id)
        );

      db.prepare(`
        DELETE FROM membership_locations
        WHERE membership_id = ?
      `).run(member.id);

      for (const location of allowedLocations) {
        db.prepare(`
          INSERT INTO membership_locations (
            membership_id,
            location_id,
            created_at
          )
          VALUES (?, ?, ?)
        `).run(
          member.id,
          location.id,
          now
        );
      }

      db.prepare(`
        UPDATE user_organizations
        SET location_id = ?
        WHERE id = ?
      `).run(
        allowedLocations[0]?.id || null,
        member.id
      );
    }

    /**
     * Fetch the updated membership.
     * This is important because location_id may have changed.
     */
    const updatedMember = db
      .prepare(`
        SELECT *
        FROM user_organizations
        WHERE id = ?
      `)
      .get(member.id) as any;

    /**
     * Audit with the actual updated location.
     */
    recordAudit(
      req.user!.id,
      'staff.updated',
      organization.id,
      updatedMember?.location_id || undefined,
      'user',
      userId,
      {
        role,
        isActive,
        locationIds: Array.isArray(locationIds)
          ? locationIds
          : undefined,
      }
    );

    return res.json({
      success: true,
      staff: updatedMember,
    });
  }
);

/**
 * List stock transfers
 */
router.get(
  '/stock-transfers',
  requirePermission('inventory.view'),
  (req: AuthRequest, res) => {
    const organization =
      getOrganizationForUser(req.user!.id);

    if (!organization) {
      return res.status(400).json({
        error: 'Organization not found',
      });
    }

    const transfers = db
      .prepare(`
        SELECT *
        FROM stock_transfers
        WHERE organization_id = ?
        ORDER BY created_at DESC
      `)
      .all(organization.id);

    return res.json({
      transfers,
    });
  }
);

/**
 * Create stock transfer
 */
router.post(
  '/stock-transfers',
  requirePermission('inventory.update'),
  (req: AuthRequest, res) => {
    const organization =
      getOrganizationForUser(req.user!.id);

    const {
      sourceLocationId,
      destinationLocationId,
      ingredientId,
      productId,
      quantity,
    } = req.body;

    if (
      !organization ||
      !sourceLocationId ||
      !destinationLocationId ||
      !quantity ||
      sourceLocationId === destinationLocationId
    ) {
      return res.status(400).json({
        error:
          'Valid source, destination, and quantity are required',
      });
    }

    if (
      typeof sourceLocationId !== 'string' ||
      typeof destinationLocationId !== 'string'
    ) {
      return res.status(400).json({
        error: 'Invalid location IDs',
      });
    }

    if (
      !canAccessLocation(
        req.user!.id,
        sourceLocationId
      ) ||
      !canAccessLocation(
        req.user!.id,
        destinationLocationId
      )
    ) {
      return res.status(403).json({
        error: 'Location access denied',
      });
    }

    const numericQuantity = Number(quantity);

    if (
      !Number.isFinite(numericQuantity) ||
      numericQuantity <= 0
    ) {
      return res.status(400).json({
        error: 'Quantity must be greater than zero',
      });
    }

    const now = new Date().toISOString();
    const id = uuidv4();

    db.prepare(`
      INSERT INTO stock_transfers (
        id,
        organization_id,
        source_location_id,
        destination_location_id,
        ingredient_id,
        product_id,
        quantity,
        status,
        created_by,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?
      )
    `).run(
      id,
      organization.id,
      sourceLocationId,
      destinationLocationId,
      ingredientId || null,
      productId || null,
      numericQuantity,
      req.user!.id,
      now,
      now
    );

    const transfer = db
      .prepare(
        'SELECT * FROM stock_transfers WHERE id = ?'
      )
      .get(id);

    recordAudit(
      req.user!.id,
      'stock_transfer.created',
      organization.id,
      sourceLocationId,
      'stock_transfer',
      id,
      {
        destinationLocationId,
        ingredientId,
        productId,
        quantity: numericQuantity,
      }
    );

    return res.status(201).json(transfer);
  }
);

/**
 * Update stock transfer status
 */
router.put(
  '/stock-transfers/:id/status',
  requirePermission('inventory.update'),
  (req: AuthRequest, res) => {
    const organization =
      getOrganizationForUser(req.user!.id);

    if (!organization) {
      return res.status(400).json({
        error: 'Organization not found',
      });
    }

    const transferId =
      typeof req.params.id === 'string'
        ? req.params.id
        : req.params.id[0];

    const { status } = req.body;

    if (
      ![
        'pending',
        'completed',
        'cancelled',
      ].includes(status)
    ) {
      return res.status(400).json({
        error: 'Invalid transfer status',
      });
    }

    const transfer = db
      .prepare(`
        SELECT *
        FROM stock_transfers
        WHERE id = ?
          AND organization_id = ?
      `)
      .get(
        transferId,
        organization.id
      ) as any;

    if (!transfer) {
      return res.status(404).json({
        error: 'Transfer not found',
      });
    }

    db.prepare(`
      UPDATE stock_transfers
      SET
        status = ?,
        updated_at = ?
      WHERE id = ?
        AND organization_id = ?
    `).run(
      status,
      new Date().toISOString(),
      transfer.id,
      organization.id
    );

    recordAudit(
      req.user!.id,
      'stock_transfer.status_updated',
      organization.id,
      transfer.source_location_id || undefined,
      'stock_transfer',
      transfer.id,
      {
        previousStatus: transfer.status,
        newStatus: status,
      }
    );

    return res.json({
      success: true,
      status,
    });
  }
);

export default router;
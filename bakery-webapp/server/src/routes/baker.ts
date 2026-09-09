import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDB, getBakeryForUser, getOrganizationForUser, canAccessLocation } from '../db/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { requireBaker, requireAuth } from '../middleware/rbac.js';
import { calculateOrderTotals, generateInvoiceNumber, toMinorUnits, fromMinorUnits } from '../lib/finance.js';

const router = Router();
router.use(authMiddleware);
router.use(requireAuth);
router.use(requireBaker);

const db = getDB();

// Helper: Get bakery_id for authenticated user
function getBakeryId(userId: string): string {
  const bakery = getBakeryForUser(userId);
  if (!bakery) {
    throw new Error('Bakery not found');
  }
  return bakery.id;
}

// GET /baker/dashboard
router.get('/dashboard', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);

    // Stats
    const orderStats = db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status IN ('pending', 'confirmed') THEN 1 END) as pending_orders,
        COALESCE(SUM(total), 0) as revenue
      FROM orders
      WHERE bakery_id = ?
    `).get(bakeryId) as any;

    // Revenue this month
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    const monthRevenue = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as revenue
      FROM orders
      WHERE bakery_id = ? AND created_at >= ?
    `).get(bakeryId, firstOfMonth.toISOString()) as any;

    // Revenue last month
    const lastMonthStart = new Date(firstOfMonth);
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
    const lastMonthEnd = new Date(firstOfMonth);
    lastMonthEnd.setDate(lastMonthEnd.getDate() - 1);
    const lastMonthRevenue = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as revenue
      FROM orders
      WHERE bakery_id = ? AND created_at >= ? AND created_at < ?
    `).get(bakeryId, lastMonthStart.toISOString(), firstOfMonth.toISOString()) as any;

    const revenueChange =
      lastMonthRevenue.revenue > 0
        ? ((monthRevenue.revenue - lastMonthRevenue.revenue) / lastMonthRevenue.revenue) * 100
        : 0;

    // Customer count
    const CustomerStats = db.prepare('SELECT COUNT(*) as count FROM Customers WHERE bakery_id = ?').get(
      bakeryId
    ) as any;

    // Product count
    const productStats = db.prepare('SELECT COUNT(*) as count FROM products WHERE bakery_id = ?').get(bakeryId) as any;

    // Low stock count
    const lowStock = db.prepare(
      'SELECT COUNT(*) as count FROM ingredients WHERE bakery_id = ? AND stock <= min_stock'
    ).get(bakeryId) as any;

    // Recent orders
    const recentOrders = db.prepare(`
      SELECT o.id, o.order_number, o.total, o.status, o.created_at, c.name as Customer_name
      FROM orders o
      JOIN Customers c ON o.Customer_id = c.id
      WHERE o.bakery_id = ?
      ORDER BY o.created_at DESC
      LIMIT 5
    `).all(bakeryId) as any[];

    // Today's orders
    const today = new Date().toISOString().split('T')[0];
    const todaysOrders = db.prepare(`
      SELECT o.id, o.order_number, o.total, o.status, o.delivery_date, c.name as Customer_name
      FROM orders o
      JOIN Customers c ON o.Customer_id = c.id
      WHERE o.bakery_id = ? AND DATE(o.delivery_date) = ?
      ORDER BY o.created_at DESC
    `).all(bakeryId, today) as any[];

    // Product performance (top 5 by revenue)
    const productPerformance = db.prepare(`
      SELECT p.id, p.name, COALESCE(SUM(oi.quantity * oi.unit_price), 0) as revenue, SUM(oi.quantity) as quantity
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      WHERE p.bakery_id = ?
      GROUP BY p.id
      ORDER BY revenue DESC
      LIMIT 5
    `).all(bakeryId) as any[];

    res.json({
      stats: {
        totalOrders: orderStats.total_orders,
        pendingOrders: orderStats.pending_orders,
        monthRevenue: monthRevenue.revenue,
        revenueChange: parseFloat(revenueChange.toFixed(2)),
        totalCustomers: CustomerStats.count,
        totalProducts: productStats.count,
        lowStockCount: lowStock.count,
      },
      recentOrders,
      todaysOrders,
      productPerformance,
    });
  } catch (err: any) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/orders
router.get('/orders', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const status = (req.query.status as string) || '';
    const search = ((req.query.search as string) || '').trim();
    const locationId = (req.query.locationId as string) || req.user!.location_id || '';
    if (locationId && !canAccessLocation(req.user!.id, locationId)) return res.status(403).json({ error: 'Location access denied' });
    const page = parseInt((req.query.page as string) || '1');
    const limit = parseInt((req.query.limit as string) || '20');
    const offset = (page - 1) * limit;

    let query = `
      SELECT o.*, c.name as Customer_name, c.email as Customer_email, c.phone as Customer_phone
      FROM orders o
      JOIN Customers c ON o.Customer_id = c.id
      WHERE o.bakery_id = ?
    `;

    const params: any[] = [bakeryId];
    if (locationId) { query += ` AND o.location_id = ?`; params.push(locationId); }

    if (status) {
      query += ` AND o.status = ?`;
      params.push(status);
    }

    if (search) {
      const searchTerm = `%${search.toLowerCase()}%`;
      query += ` AND (LOWER(o.order_number) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(c.email) LIKE ?)`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ` ORDER BY o.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const orders = db.prepare(query).all(...params) as any[];

    let countQuery = 'SELECT COUNT(*) as count FROM orders o JOIN Customers c ON o.Customer_id = c.id WHERE o.bakery_id = ?';
    const countParams: any[] = [bakeryId];
    if (locationId) { countQuery += ` AND o.location_id = ?`; countParams.push(locationId); }

    if (status) {
      countQuery += ` AND o.status = ?`;
      countParams.push(status);
    }

    if (search) {
      const searchTerm = `%${search.toLowerCase()}%`;
      countQuery += ` AND (LOWER(o.order_number) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(c.email) LIKE ?)`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    const totalCount = db.prepare(countQuery).get(...countParams) as any;

    // Get items for each order
    const enrichedOrders = orders.map((order: any) => {
      const items = db.prepare(`
        SELECT oi.*, p.name as product_name
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `).all(order.id);

      return {
        ...order,
        items,
      };
    });

    res.json({
      orders: enrichedOrders,
      pagination: {
        page,
        limit,
        total: totalCount.count,
        pages: Math.ceil(totalCount.count / limit),
      },
    });
  } catch (err: any) {
    console.error('Get orders error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /baker/orders
router.post('/orders', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const { CustomerId, items, deliveryDate, deliveryType, notes, paymentStatus, discountType, discountValue } = req.body;

    if (!CustomerId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields: CustomerId, items' });
    }

    const Customer = db.prepare('SELECT id FROM Customers WHERE id = ? AND bakery_id = ?').get(
      CustomerId,
      bakeryId
    );

    if (!Customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const orderId = uuidv4();
    const orderNumber = `ORD-${Date.now()}`;
    const now = new Date().toISOString();

    const organization = getOrganizationForUser(req.user!.id);
    if (!organization) return res.status(400).json({ error: 'Organization not found' });

    // Calculate all order values in minor currency units to avoid floating-point drift.
    let subtotalMinor = 0;
    const pricedItems: Array<{ item: any; price: number; priceMinor: number }> = [];
    for (const item of items) {
      const product = db.prepare('SELECT price FROM products WHERE id = ? AND bakery_id = ?').get(
        item.productId,
        bakeryId
      ) as any;

      if (!product) {
        return res.status(404).json({ error: `Product ${item.productId} not found` });
      }

      const priceMinor = toMinorUnits(product.price);
      subtotalMinor += priceMinor * Math.max(0, Number(item.quantity));
      pricedItems.push({ item, price: fromMinorUnits(priceMinor), priceMinor });
    }
    const totals = calculateOrderTotals(subtotalMinor, { type: discountType || 'fixed', value: discountValue || 0 }, {
      name: organization.tax_name,
      type: organization.tax_type,
      rate: organization.tax_rate,
      inclusive: organization.tax_inclusive,
    });
    const total = fromMinorUnits(totals.totalMinor);
    const discount = fromMinorUnits(totals.discountMinor);
    const tax = fromMinorUnits(totals.taxMinor);
    const invoiceSequence = (db.prepare('SELECT COUNT(*) as count FROM invoices WHERE organization_id = ?').get(organization.id) as any).count + 1;
    const invoiceNumber = generateInvoiceNumber(organization.id, invoiceSequence);

    const transaction = db.transaction(() => {
      // Create order
      db.prepare(`
        INSERT INTO orders (id, bakery_id, organization_id, Customer_id, location_id, order_number, status, total, subtotal, discount, discount_type, discount_value, tax, tax_rate, tax_name, tax_inclusive, invoice_number, currency, total_minor, notes, delivery_date, delivery_type, payment_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderId,
        bakeryId,
        organization.id,
        CustomerId,
        req.user!.location_id || null,
        orderNumber,
        'pending',
        total,
        fromMinorUnits(totals.subtotalMinor),
        discount,
        discountType || 'fixed',
        discountValue || 0,
        tax,
        organization.tax_rate || 0,
        organization.tax_name || organization.tax_type || null,
        organization.tax_inclusive ? 1 : 0,
        invoiceNumber,
        organization.currency || 'BRL',
        totals.totalMinor,
        notes || null,
        deliveryDate || null,
        deliveryType || 'pickup',
        paymentStatus || 'unpaid',
        now,
        now
      );

      // Create order items
      for (const { item, price, priceMinor } of pricedItems) {
        db.prepare(`
          INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, total_minor, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), orderId, item.productId, item.quantity, price, priceMinor * item.quantity, item.notes || null);
      }

      const CustomerData = db.prepare('SELECT name, email FROM Customers WHERE id = ? AND bakery_id = ?').get(CustomerId, bakeryId) as any;
      db.prepare(`
        INSERT INTO invoices (id, organization_id, location_id, order_id, invoice_number, business_name, business_address, Customer_name, Customer_email, currency, subtotal, discount, tax, total, payment_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), organization.id, req.user!.location_id || null, orderId, invoiceNumber, organization.name, organization.address_line1 || organization.address, CustomerData?.name, CustomerData?.email, organization.currency || 'BRL', fromMinorUnits(totals.subtotalMinor), discount, tax, total, paymentStatus || 'unpaid', now);

      // Update Customer stats
      db.prepare(`
        UPDATE Customers SET total_orders = total_orders + 1, total_spent = total_spent + ? WHERE id = ?
      `).run(total, CustomerId);
    });

    transaction();

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const orderItems = db.prepare(`
      SELECT oi.*, p.name as product_name FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(orderId);

    res.status(201).json({ ...(order as any), items: orderItems });
  } catch (err: any) {
    console.error('Create order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/orders/:id
router.get('/orders/:id', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const orderId = req.params.id as string;

    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND bakery_id = ?').get(orderId, bakeryId) as any;

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const items = db.prepare(`
      SELECT oi.*, p.name as product_name, p.description
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(orderId);

    const Customer = db.prepare('SELECT * FROM Customers WHERE id = ?').get(order.Customer_id);

    res.json({ ...order, items, Customer });
  } catch (err: any) {
    console.error('Get order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /baker/orders/:id
router.put('/orders/:id', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const orderId = req.params.id as string;
    const { status, paymentStatus, notes, deliveryDate, deliveryType } = req.body;

    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND bakery_id = ?').get(orderId, bakeryId) as any;

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const now = new Date().toISOString();
    let updateQuery = 'UPDATE orders SET updated_at = ?';
    const updateParams: any[] = [now];

    if (status) {
      updateQuery += ', status = ?';
      updateParams.push(status);
    }
    if (paymentStatus) {
      updateQuery += ', payment_status = ?';
      updateParams.push(paymentStatus);
    }
    if (notes !== undefined) {
      updateQuery += ', notes = ?';
      updateParams.push(notes || null);
    }
    if (deliveryDate) {
      updateQuery += ', delivery_date = ?';
      updateParams.push(deliveryDate);
    }
    if (deliveryType) {
      updateQuery += ', delivery_type = ?';
      updateParams.push(deliveryType);
    }

    updateQuery += ' WHERE id = ?';
    updateParams.push(orderId);

    db.prepare(updateQuery).run(...updateParams);

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

    res.json(updated);
  } catch (err: any) {
    console.error('Update order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /baker/orders/:id
router.delete('/orders/:id', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const orderId = req.params.id as string;

    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND bakery_id = ?').get(orderId, bakeryId) as any;

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const transaction = db.transaction(() => {
      // Update Customer stats
      db.prepare(`
        UPDATE Customers SET total_orders = total_orders - 1, total_spent = total_spent - ? WHERE id = ?
      `).run(order.total, order.Customer_id);

      // Delete order items and order
      db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
    });

    transaction();

    res.json({ message: 'Order deleted' });
  } catch (err: any) {
    console.error('Delete order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/products
router.get('/products', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const page = parseInt((req.query.page as string) || '1');
    const limit = parseInt((req.query.limit as string) || '50');
    const offset = (page - 1) * limit;

    const products = db.prepare(`
      SELECT * FROM products
      WHERE bakery_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(bakeryId, limit, offset) as any[];

    const totalCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE bakery_id = ?').get(bakeryId) as any;

    res.json({
      products,
      pagination: {
        page,
        limit,
        total: totalCount.count,
        pages: Math.ceil(totalCount.count / limit),
      },
    });
  } catch (err: any) {
    console.error('Get products error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /baker/products
router.post('/products', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const { name, description, category, price, cost, prepTimeMinutes } = req.body;

    if (!name || !price) {
      return res.status(400).json({ error: 'Name and price required' });
    }

    const productId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO products (id, bakery_id, name, description, category, price, cost, prep_time_minutes, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      bakeryId,
      name,
      description || null,
      category || null,
      price,
      cost || null,
      prepTimeMinutes || null,
      1,
      now
    );

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);

    res.status(201).json(product);
  } catch (err: any) {
    console.error('Create product error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /baker/products/:id
router.put('/products/:id', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const productId = req.params.id as string;
    const { name, description, category, price, cost, prepTimeMinutes, isActive } = req.body;

    const product = db.prepare('SELECT id FROM products WHERE id = ? AND bakery_id = ?').get(
      productId,
      bakeryId
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    let updateQuery = 'UPDATE products SET ';
    const params: any[] = [];

    if (name) {
      updateQuery += 'name = ?, ';
      params.push(name);
    }
    if (description !== undefined) {
      updateQuery += 'description = ?, ';
      params.push(description || null);
    }
    if (category !== undefined) {
      updateQuery += 'category = ?, ';
      params.push(category || null);
    }
    if (price !== undefined) {
      updateQuery += 'price = ?, ';
      params.push(price);
    }
    if (cost !== undefined) {
      updateQuery += 'cost = ?, ';
      params.push(cost || null);
    }
    if (prepTimeMinutes !== undefined) {
      updateQuery += 'prep_time_minutes = ?, ';
      params.push(prepTimeMinutes || null);
    }
    if (isActive !== undefined) {
      updateQuery += 'is_active = ?, ';
      params.push(isActive ? 1 : 0);
    }

    if (params.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateQuery = updateQuery.slice(0, -2) + ' WHERE id = ?';
    params.push(productId);

    db.prepare(updateQuery).run(...params);

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);

    res.json(updated);
  } catch (err: any) {
    console.error('Update product error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /baker/products/:id
router.delete('/products/:id', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const productId = req.params.id as string;

    const product = db.prepare('SELECT id FROM products WHERE id = ? AND bakery_id = ?').get(
      productId,
      bakeryId
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const references = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM order_items WHERE product_id = ?) AS order_item_count,
        (SELECT COUNT(*) FROM recipe_items WHERE product_id = ?) AS recipe_item_count
    `).get(productId, productId) as { order_item_count: number; recipe_item_count: number };

    if ((references.order_item_count ?? 0) > 0 || (references.recipe_item_count ?? 0) > 0) {
      return res.status(409).json({
        error: 'Cannot delete this product because it is still referenced by existing orders or recipe items. Deactivate it instead.'
      });
    }

    db.prepare('DELETE FROM products WHERE id = ? AND bakery_id = ?').run(productId, bakeryId);

    res.json({ message: 'Product deleted' });
  } catch (err: any) {
    console.error('Delete product error:', err);
    if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(409).json({
        error: 'Cannot delete this product because it is still referenced by existing orders or recipe items. Deactivate it instead.'
      });
    }
    res.status(500).json({ error: err.message || 'Failed to delete product' });
  }
});

// GET /baker/Customers
router.get('/Customers', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const page = parseInt((req.query.page as string) || '1');
    const limit = parseInt((req.query.limit as string) || '50');
    const offset = (page - 1) * limit;

    const Customers = db.prepare(`
      SELECT * FROM Customers
      WHERE bakery_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(bakeryId, limit, offset) as any[];

    const totalCount = db.prepare('SELECT COUNT(*) as count FROM Customers WHERE bakery_id = ?').get(bakeryId) as any;

    res.json({
      Customers,
      pagination: {
        page,
        limit,
        total: totalCount.count,
        pages: Math.ceil(totalCount.count / limit),
      },
    });
  } catch (err: any) {
    console.error('Get Customers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /baker/Customers
router.post('/Customers', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const { name, email, phone, address, notes, isWholesale, companyName } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name required' });
    }

    const CustomerId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO Customers (id, bakery_id, name, email, phone, address, notes, is_wholesale, company_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      CustomerId,
      bakeryId,
      name,
      email || null,
      phone || null,
      address || null,
      notes || null,
      isWholesale ? 1 : 0,
      companyName || null,
      now
    );

    const Customer = db.prepare('SELECT * FROM Customers WHERE id = ?').get(CustomerId);

    res.status(201).json(Customer);
  } catch (err: any) {
    console.error('Create Customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /baker/Customers/:id
router.put('/Customers/:id', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const CustomerId = req.params.id as string;
    const { name, email, phone, address, notes, isWholesale, companyName } = req.body;

    const Customer = db.prepare('SELECT id FROM Customers WHERE id = ? AND bakery_id = ?').get(
      CustomerId,
      bakeryId
    );

    if (!Customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    let updateQuery = 'UPDATE Customers SET ';
    const params: any[] = [];

    if (name) {
      updateQuery += 'name = ?, ';
      params.push(name);
    }
    if (email !== undefined) {
      updateQuery += 'email = ?, ';
      params.push(email || null);
    }
    if (phone !== undefined) {
      updateQuery += 'phone = ?, ';
      params.push(phone || null);
    }
    if (address !== undefined) {
      updateQuery += 'address = ?, ';
      params.push(address || null);
    }
    if (notes !== undefined) {
      updateQuery += 'notes = ?, ';
      params.push(notes || null);
    }
    if (isWholesale !== undefined) {
      updateQuery += 'is_wholesale = ?, ';
      params.push(isWholesale ? 1 : 0);
    }
    if (companyName !== undefined) {
      updateQuery += 'company_name = ?, ';
      params.push(companyName || null);
    }

    if (params.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateQuery = updateQuery.slice(0, -2) + ' WHERE id = ?';
    params.push(CustomerId);

    db.prepare(updateQuery).run(...params);

    const updated = db.prepare('SELECT * FROM Customers WHERE id = ?').get(CustomerId);

    res.json(updated);
  } catch (err: any) {
    console.error('Update Customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/inventory
router.get('/inventory', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const page = parseInt((req.query.page as string) || '1');
    const limit = parseInt((req.query.limit as string) || '50');
    const offset = (page - 1) * limit;

    const ingredients = db.prepare(`
      SELECT * FROM ingredients
      WHERE bakery_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(bakeryId, limit, offset) as any[];

    const totalCount = db.prepare('SELECT COUNT(*) as count FROM ingredients WHERE bakery_id = ?').get(bakeryId) as any;

    res.json({
      ingredients,
      pagination: {
        page,
        limit,
        total: totalCount.count,
        pages: Math.ceil(totalCount.count / limit),
      },
    });
  } catch (err: any) {
    console.error('Get inventory error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /baker/inventory
router.post('/inventory', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const { name, unit, costPerUnit, stock, minStock, category } = req.body;

    if (!name || !unit || costPerUnit === undefined || stock === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const ingredientId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO ingredients (id, bakery_id, name, unit, cost_per_unit, stock, min_stock, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ingredientId,
      bakeryId,
      name,
      unit,
      costPerUnit,
      stock,
      minStock || null,
      category || null,
      now,
      now
    );

    const ingredient = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(ingredientId);

    res.status(201).json(ingredient);
  } catch (err: any) {
    console.error('Create ingredient error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /baker/inventory/:id
router.put('/inventory/:id', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const ingredientId = req.params.id as string;
    const { name, unit, costPerUnit, stock, minStock, category } = req.body;

    const ingredient = db.prepare('SELECT id FROM ingredients WHERE id = ? AND bakery_id = ?').get(
      ingredientId,
      bakeryId
    );

    if (!ingredient) {
      return res.status(404).json({ error: 'Ingredient not found' });
    }

    let updateQuery = 'UPDATE ingredients SET ';
    const params: any[] = [];

    if (name) {
      updateQuery += 'name = ?, ';
      params.push(name);
    }
    if (unit) {
      updateQuery += 'unit = ?, ';
      params.push(unit);
    }
    if (costPerUnit !== undefined) {
      updateQuery += 'cost_per_unit = ?, ';
      params.push(costPerUnit);
    }
    if (stock !== undefined) {
      updateQuery += 'stock = ?, ';
      params.push(stock);
    }
    if (minStock !== undefined) {
      updateQuery += 'min_stock = ?, ';
      params.push(minStock || null);
    }
    if (category !== undefined) {
      updateQuery += 'category = ?, ';
      params.push(category || null);
    }

    updateQuery += 'updated_at = ? WHERE id = ?';
    params.push(new Date().toISOString(), ingredientId);

    db.prepare(updateQuery).run(...params);

    const updated = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(ingredientId);

    res.json(updated);
  } catch (err: any) {
    console.error('Update ingredient error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/employees
router.get('/employees', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);

    const employees = db.prepare(
      'SELECT * FROM employees WHERE bakery_id = ? AND is_active = 1 ORDER BY created_at DESC'
    ).all(bakeryId) as any[];

    res.json({ employees });
  } catch (err: any) {
    console.error('Get employees error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /baker/employees
router.post('/employees', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const { name, email, phone, role, hourlyRate } = req.body;

    if (!name || !role) {
      return res.status(400).json({ error: 'Name and role required' });
    }

    const employeeId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO employees (id, bakery_id, name, email, phone, role, hourly_rate, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(employeeId, bakeryId, name, email || null, phone || null, role, hourlyRate || null, 1, now);

    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);

    res.status(201).json(employee);
  } catch (err: any) {
    console.error('Create employee error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/notifications
router.get('/notifications', (req: AuthRequest, res: any) => {
  try {
    const notifications = db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ? AND is_read = 0
      ORDER BY created_at DESC
      LIMIT 20
    `).all(req.user!.id) as any[];

    res.json({ notifications });
  } catch (err: any) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /baker/notifications/:id/read
router.put('/notifications/:id/read', (req: AuthRequest, res: any) => {
  try {
    const notificationId = req.params.id as string;

    const notification = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(
      notificationId,
      req.user!.id
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(notificationId);

    const updated = db.prepare('SELECT * FROM notifications WHERE id = ?').get(notificationId);

    res.json(updated);
  } catch (err: any) {
    console.error('Update notification error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/onboarding
router.get('/onboarding', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);

    const steps = db.prepare(`
      SELECT * FROM onboarding_steps
      WHERE bakery_id = ?
      ORDER BY step
    `).all(bakeryId) as any[];

    const completed = steps.filter((s: any) => s.completed).length;
    const total = steps.length;

    res.json({
      steps,
      progress: {
        completed,
        total,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
    });
  } catch (err: any) {
    console.error('Get onboarding error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /baker/onboarding/:step
router.put('/onboarding/:step', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const step = req.params.step as string;

    const onboarding = db.prepare('SELECT * FROM onboarding_steps WHERE bakery_id = ? AND step = ?').get(
      bakeryId,
      step
    ) as any;

    if (!onboarding) {
      return res.status(404).json({ error: 'Onboarding step not found' });
    }

    const now = new Date().toISOString();

    db.prepare('UPDATE onboarding_steps SET completed = 1, completed_at = ? WHERE bakery_id = ? AND step = ?').run(
      now,
      bakeryId,
      step
    );

    const updated = db.prepare('SELECT * FROM onboarding_steps WHERE bakery_id = ? AND step = ?').get(bakeryId, step);

    res.json(updated);
  } catch (err: any) {
    console.error('Update onboarding error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/payments
router.get('/payments', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const page = parseInt((req.query.page as string) || '1');
    const limit = parseInt((req.query.limit as string) || '50');
    const offset = (page - 1) * limit;
    const method = (req.query.method as string) || '';
    const locationId = (req.query.locationId as string) || req.user!.location_id || '';
    if (locationId && !canAccessLocation(req.user!.id, locationId)) return res.status(403).json({ error: 'Location access denied' });

    let query = `
      SELECT p.*, c.name as Customer_name, o.order_number
      FROM payments p
      LEFT JOIN Customers c ON p.Customer_id = c.id
      LEFT JOIN orders o ON p.order_id = o.id
      WHERE p.bakery_id = ?
    `;
    const params: any[] = [bakeryId];
    if (locationId) { query += ` AND p.location_id = ?`; params.push(locationId); }

    if (method) {
      query += ` AND p.method = ?`;
      params.push(method);
    }

    query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const payments = db.prepare(query).all(...params) as any[];

    let countQuery = 'SELECT COUNT(*) as count FROM payments WHERE bakery_id = ?';
    const countParams: any[] = [bakeryId];
    if (locationId) { countQuery += ` AND location_id = ?`; countParams.push(locationId); }
    if (method) {
      countQuery += ` AND method = ?`;
      countParams.push(method);
    }
    const totalCount = db.prepare(countQuery).get(...countParams) as any;

    // Payment summary
    const summary = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as total_received,
        COUNT(*) as total_payments,
        COALESCE(SUM(CASE WHEN method = 'pix' THEN amount ELSE 0 END), 0) as pix_total,
        COALESCE(SUM(CASE WHEN method = 'cash' THEN amount ELSE 0 END), 0) as cash_total,
        COALESCE(SUM(CASE WHEN method = 'card' THEN amount ELSE 0 END), 0) as card_total,
        COUNT(CASE WHEN method = 'pix' THEN 1 END) as pix_count,
        COUNT(CASE WHEN method = 'cash' THEN 1 END) as cash_count,
        COUNT(CASE WHEN method = 'card' THEN 1 END) as card_count
      FROM payments
      WHERE bakery_id = ? AND status = 'completed'
    `).get(bakeryId) as any;

    // This month
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    const monthSummary = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as month_total,
        COUNT(*) as month_count
      FROM payments
      WHERE bakery_id = ? AND status = 'completed' AND created_at >= ?
    `).get(bakeryId, firstOfMonth.toISOString()) as any;

    res.json({
      payments,
      total_received: Number(summary.total_received || 0),
      total_payments: Number(summary.total_payments || 0),
      pix_total: Number(summary.pix_total || 0),
      cash_total: Number(summary.cash_total || 0),
      card_total: Number(summary.card_total || 0),
      month_total: Number(monthSummary.month_total || 0),
      pagination: {
        page,
        limit,
        total: totalCount.count,
        pages: Math.ceil(totalCount.count / limit),
      },
    });
  } catch (err: any) {
    console.error('Get payments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /baker/payments
router.post('/payments', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const { orderId, CustomerId, amount, method, reference, notes, provider, transactionId, metadata } = req.body;
    const normalizedMethod = String(method || '').trim().toLowerCase();
    const numericAmount = Number(amount);

    if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'A valid payment amount greater than 0 is required.' });
    }

    if (!['pix', 'cash', 'card'].includes(normalizedMethod)) {
      return res.status(400).json({ error: 'Payment method must be PIX, Cash, or Card.' });
    }

    const organization = getOrganizationForUser(req.user!.id);
    if (!organization) return res.status(400).json({ error: 'Organization not found' });

    if (orderId) {
      const order = db.prepare('SELECT id FROM orders WHERE id = ? AND bakery_id = ?').get(orderId, bakeryId) as any;
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }
    }

    if (CustomerId) {
      const Customer = db.prepare('SELECT id FROM Customers WHERE id = ? AND bakery_id = ?').get(CustomerId, bakeryId) as any;
      if (!Customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }
    }

    const paymentId = uuidv4();
    const amountMinor = toMinorUnits(numericAmount);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO payments (id, bakery_id, organization_id, location_id, order_id, Customer_id, amount, amount_minor, currency, provider, transaction_id, metadata, method, status, reference, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(paymentId, bakeryId, organization.id, req.user!.location_id || null, orderId || null, CustomerId || null, fromMinorUnits(amountMinor), amountMinor, organization.currency || 'BRL', provider || 'mAnnual', transactionId || null, JSON.stringify(metadata || {}), normalizedMethod, 'completed', reference || null, notes || null, now);
    db.prepare(`
      INSERT INTO payment_transactions (id, organization_id, location_id, order_id, provider, transaction_id, amount, amount_minor, currency, status, payment_method, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?)
    `).run(uuidv4(), organization.id, req.user!.location_id || null, orderId || null, provider || 'mAnnual', transactionId || paymentId, fromMinorUnits(amountMinor), amountMinor, organization.currency || 'BRL', normalizedMethod, JSON.stringify(metadata || {}), now, now);

    // If linked to an order, update payment status
    if (orderId) {
      const order = db.prepare('SELECT total FROM orders WHERE id = ? AND bakery_id = ?').get(orderId, bakeryId) as any;
      if (order) {
        const totalPaid = db.prepare(
          'SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE order_id = ? AND status = ?'
        ).get(orderId, 'completed') as any;

        const newStatus = totalPaid.paid >= order.total ? 'paid' : 'partial';
        db.prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, orderId);
      }
    }

    const payment = db.prepare(`
      SELECT p.*, c.name as Customer_name, o.order_number
      FROM payments p
      LEFT JOIN Customers c ON p.Customer_id = c.id
      LEFT JOIN orders o ON p.order_id = o.id
      WHERE p.id = ?
    `).get(paymentId);

    res.status(201).json(payment);
  } catch (err: any) {
    console.error('Create payment error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/reports
router.get('/reports', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);

    // Revenue by month (last 12 months)
    const revenueByMonth = db.prepare(`
      SELECT
        strftime('%Y-%m', created_at) as month,
        COALESCE(SUM(total), 0) as revenue,
        COUNT(*) as order_count
      FROM orders
      WHERE bakery_id = ? AND created_at >= date('now', '-12 months')
      GROUP BY strftime('%Y-%m', created_at)
      ORDER BY month
    `).all(bakeryId) as any[];

    // Orders by status
    const ordersByStatus = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM orders
      WHERE bakery_id = ?
      GROUP BY status
    `).all(bakeryId) as any[];

    // Top products by revenue
    const topProducts = db.prepare(`
      SELECT p.name, SUM(oi.quantity * oi.unit_price) as revenue, SUM(oi.quantity) as quantity_sold
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.bakery_id = ?
      GROUP BY p.id
      ORDER BY revenue DESC
      LIMIT 10
    `).all(bakeryId) as any[];

    // Top Customers by revenue
    const topCustomers = db.prepare(`
      SELECT c.name, c.total_orders, c.total_spent
      FROM Customers c
      WHERE c.bakery_id = ?
      ORDER BY c.total_spent DESC
      LIMIT 10
    `).all(bakeryId) as any[];

    // Payment method breakdown
    const paymentMethods = db.prepare(`
      SELECT method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
      FROM payments
      WHERE bakery_id = ? AND status = 'completed'
      GROUP BY method
    `).all(bakeryId) as any[];

    // Revenue by day of week
    const revenueByDayOfWeek = db.prepare(`
      SELECT
        CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
        COALESCE(SUM(total), 0) as revenue,
        COUNT(*) as order_count
      FROM orders
      WHERE bakery_id = ? AND created_at >= date('now', '-3 months')
      GROUP BY strftime('%w', created_at)
      ORDER BY day_of_week
    `).all(bakeryId) as any[];

    res.json({
      revenueByMonth,
      ordersByStatus,
      topProducts,
      topCustomers,
      paymentMethods,
      revenueByDayOfWeek,
    });
  } catch (err: any) {
    console.error('Get reports error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/profile
router.get('/profile', (req: AuthRequest, res: any) => {
  try {
    const user = db.prepare('SELECT id, email, name, phone, avatar_url, created_at FROM users WHERE id = ?').get(req.user!.id) as any;
    const bakery = getBakeryForUser(req.user!.id);
    const subscription = db.prepare('SELECT * FROM subscriptions WHERE bakery_id = ?').get(bakery.id) as any;

    const organization = getOrganizationForUser(req.user!.id);
    res.json({ user, bakery, subscription, organization });
  } catch (err: any) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /baker/profile
router.put('/profile', (req: AuthRequest, res: any) => {
  try {
    const { name, phone, bakeryName, description, address, city, organization: organizationSettings } = req.body;
    const now = new Date().toISOString();

    if (name || phone) {
      let q = 'UPDATE users SET ';
      const p: any[] = [];
      if (name) { q += 'name = ?, '; p.push(name); }
      if (phone !== undefined) { q += 'phone = ?, '; p.push(phone || null); }
      q = q.slice(0, -2) + ' WHERE id = ?';
      p.push(req.user!.id);
      db.prepare(q).run(...p);
    }

    const bakery = getBakeryForUser(req.user!.id);
    if (bakery && (bakeryName || description !== undefined || address !== undefined || city !== undefined)) {
      let q = 'UPDATE bakeries SET updated_at = ?, ';
      const p: any[] = [now];
      if (bakeryName) { q += 'name = ?, '; p.push(bakeryName); }
      if (description !== undefined) { q += 'description = ?, '; p.push(description || null); }
      if (address !== undefined) { q += 'address = ?, '; p.push(address || null); }
      if (city !== undefined) { q += 'city = ?, '; p.push(city || null); }
      q = q.slice(0, -2) + ' WHERE id = ?';
      p.push(bakery.id);
      db.prepare(q).run(...p);
    }

    const user = db.prepare('SELECT id, email, name, phone, avatar_url FROM users WHERE id = ?').get(req.user!.id);
    const updatedBakery = getBakeryForUser(req.user!.id);
    const organization = getOrganizationForUser(req.user!.id);
    if (organization && organizationSettings && req.user!.id) {
      const allowedFields: Record<string, string> = {
        country: 'country', stateProvince: 'state_province', city: 'city', address: 'address',
        addressLine1: 'address_line1', addressLine2: 'address_line2', postalCode: 'postal_code',
        currency: 'currency', timezone: 'timezone', locale: 'locale', measurementSystem: 'measurement_system',
        taxName: 'tax_name', taxType: 'tax_type', taxRate: 'tax_rate', taxInclusive: 'tax_inclusive',
      };
      const updates: string[] = ['updated_at = ?'];
      const values: any[] = [now];
      for (const [input, column] of Object.entries(allowedFields)) {
        if (organizationSettings[input] !== undefined) {
          updates.push(`${column} = ?`);
          values.push(organizationSettings[input]);
        }
      }
      if (updates.length > 1) {
        values.push(organization.id);
        db.prepare(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
    }

    res.json({ user, bakery: updatedBakery, organization: getOrganizationForUser(req.user!.id) });
  } catch (err: any) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/features
router.get('/features', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);

    const bakery = db.prepare('SELECT tier FROM bakeries WHERE id = ?').get(bakeryId) as any;

    const tiers = ['free', 'starter', 'pro', 'enterprise'];
    const tierIndex = tiers.indexOf(bakery.tier);

    const allFeatures = db.prepare('SELECT * FROM features ORDER BY category, name').all() as any[];

    const enriched = allFeatures.map((feature: any) => ({
      ...feature,
      unlocked: tiers.indexOf(feature.tier_required) <= tierIndex,
    }));

    res.json({ features: enriched, currentTier: bakery.tier });
  } catch (err: any) {
    console.error('Get features error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/production - Production queue for today/tomorrow
router.get('/production', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const statuses = ['pending', 'confirmed', 'production', 'ready', 'delivered'];
    const result: Record<string, any[]> = {
      pending: [],
      production: [],
      ready: [],
      delivered: [],
    };

    for (const status of statuses) {
      const orders = db.prepare(`
        SELECT o.id, o.order_number, o.total, o.status, o.delivery_date, c.name as Customer_name
        FROM orders o
        JOIN Customers c ON o.Customer_id = c.id
        WHERE o.bakery_id = ? AND o.status = ?
          AND (DATE(o.delivery_date) = ? OR DATE(o.delivery_date) = ?)
        ORDER BY o.delivery_date ASC, o.created_at ASC
      `).all(bakeryId, status, today, tomorrow) as any[];

      // Get items for each order
      const enriched = orders.map((order: any) => {
        const items = db.prepare(`
          SELECT oi.*, p.name as product_name
          FROM order_items oi
          JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = ?
        `).all(order.id);

        const isUrgent = order.delivery_date && order.delivery_date.split('T')[0] === today;

        return {
          ...order,
          items,
          isUrgent,
        };
      });

      result[status] = enriched;
    }

    // Summary stats
    const allOrders = db.prepare(`
      SELECT COUNT(*) as count
      FROM orders
      WHERE bakery_id = ? AND (DATE(delivery_date) = ? OR DATE(delivery_date) = ?)
    `).get(bakeryId, today, tomorrow) as any;

    res.json({
      data: result,
      stats: {
        totalOrders: allOrders.count,
        pendingCount: result.pending.length,
        productionCount: result.production.length,
        readyCount: result.ready.length,
        deliveredCount: result.delivered.length,
      },
    });
  } catch (err: any) {
    console.error('Get production error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/recipes - All products with recipe costs
router.get('/recipes', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);

    const products = db.prepare(`
      SELECT * FROM products WHERE bakery_id = ? ORDER BY name ASC
    `).all(bakeryId) as any[];

    const enriched = products.map((product: any) => {
      const recipeItems = db.prepare(`
        SELECT ri.*, i.name as ingredient_name, i.cost_per_unit, i.unit
        FROM recipe_items ri
        JOIN ingredients i ON ri.ingredient_id = i.id
        WHERE ri.product_id = ?
      `).all(product.id) as any[];

      let ingredientCost = 0;
      recipeItems.forEach((item: any) => {
        ingredientCost += (item.quantity_per_batch * item.cost_per_unit) / item.batch_size;
      });

      const margin = product.price > 0 ? ((product.price - ingredientCost) / product.price) * 100 : 0;
      const profit = product.price - ingredientCost;

      return {
        ...product,
        ingredientCost: parseFloat(ingredientCost.toFixed(2)),
        margin: parseFloat(margin.toFixed(2)),
        profit: parseFloat(profit.toFixed(2)),
        recipeItems,
      };
    });

    res.json({ products: enriched });
  } catch (err: any) {
    console.error('Get recipes error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/recipes/:productId
router.get('/recipes/:productId', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const productId = req.params.productId as string;

    const product = db.prepare(`
      SELECT * FROM products WHERE id = ? AND bakery_id = ?
    `).get(productId, bakeryId) as any;

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const recipeItems = db.prepare(`
      SELECT ri.*, i.name as ingredient_name, i.cost_per_unit, i.unit
      FROM recipe_items ri
      JOIN ingredients i ON ri.ingredient_id = i.id
      WHERE ri.product_id = ?
    `).all(productId) as any[];

    let ingredientCost = 0;
    recipeItems.forEach((item: any) => {
      ingredientCost += (item.quantity_per_batch * item.cost_per_unit) / item.batch_size;
    });

    const margin = product.price > 0 ? ((product.price - ingredientCost) / product.price) * 100 : 0;
    const profit = product.price - ingredientCost;

    res.json({
      ...product,
      ingredientCost: parseFloat(ingredientCost.toFixed(2)),
      margin: parseFloat(margin.toFixed(2)),
      profit: parseFloat(profit.toFixed(2)),
      recipeItems,
    });
  } catch (err: any) {
    console.error('Get recipe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /baker/recipes/:productId/items
router.post('/recipes/:productId/items', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const productId = req.params.productId as string;
    const { ingredientId, quantityPerBatch, batchSize } = req.body;

    if (!ingredientId || quantityPerBatch === undefined) {
      return res.status(400).json({ error: 'ingredientId and quantityPerBatch required' });
    }

    const product = db.prepare('SELECT id FROM products WHERE id = ? AND bakery_id = ?').get(productId, bakeryId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const ingredient = db.prepare('SELECT id FROM ingredients WHERE id = ? AND bakery_id = ?').get(
      ingredientId,
      bakeryId
    );
    if (!ingredient) {
      return res.status(404).json({ error: 'Ingredient not found' });
    }

    const recipeItemId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO recipe_items (id, product_id, ingredient_id, quantity_per_batch, batch_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(recipeItemId, productId, ingredientId, quantityPerBatch, batchSize || 1, now);

    const item = db.prepare(`
      SELECT ri.*, i.name as ingredient_name, i.cost_per_unit, i.unit
      FROM recipe_items ri
      JOIN ingredients i ON ri.ingredient_id = i.id
      WHERE ri.id = ?
    `).get(recipeItemId);

    res.status(201).json(item);
  } catch (err: any) {
    console.error('Create recipe item error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /baker/recipes/:productId/items/:itemId
router.delete('/recipes/:productId/items/:itemId', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const productId = req.params.productId as string;
    const itemId = req.params.itemId as string;

    const product = db.prepare('SELECT id FROM products WHERE id = ? AND bakery_id = ?').get(productId, bakeryId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const item = db.prepare('SELECT * FROM recipe_items WHERE id = ? AND product_id = ?').get(itemId, productId);
    if (!item) {
      return res.status(404).json({ error: 'Recipe item not found' });
    }

    db.prepare('DELETE FROM recipe_items WHERE id = ?').run(itemId);

    res.json({ message: 'Recipe item deleted' });
  } catch (err: any) {
    console.error('Delete recipe item error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/recipe-costing - Costing summary for all products
router.get('/recipe-costing', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);

    const products = db.prepare(`
      SELECT * FROM products WHERE bakery_id = ? ORDER BY name ASC
    `).all(bakeryId) as any[];

    const costingData = products.map((product: any) => {
      const recipeItems = db.prepare(`
        SELECT ri.*, i.cost_per_unit
        FROM recipe_items ri
        JOIN ingredients i ON ri.ingredient_id = i.id
        WHERE ri.product_id = ?
      `).all(product.id) as any[];

      let ingredientCost = 0;
      recipeItems.forEach((item: any) => {
        ingredientCost += (item.quantity_per_batch * item.cost_per_unit) / item.batch_size;
      });

      const margin = product.price > 0 ? ((product.price - ingredientCost) / product.price) * 100 : 0;
      const profit = product.price - ingredientCost;

      return {
        id: product.id,
        name: product.name,
        price: product.price,
        ingredientCost: parseFloat(ingredientCost.toFixed(2)),
        margin: parseFloat(margin.toFixed(2)),
        profit: parseFloat(profit.toFixed(2)),
      };
    });

    const avgMargin = costingData.length > 0
      ? costingData.reduce((sum, p) => sum + p.margin, 0) / costingData.length
      : 0;

    const lowestMarginProducts = costingData.slice().sort((a, b) => a.margin - b.margin).slice(0, 5);
    const highestProfitProducts = costingData.slice().sort((a, b) => b.profit - a.profit).slice(0, 5);

    res.json({
      products: costingData,
      summary: {
        averageMargin: parseFloat(avgMargin.toFixed(2)),
        totalProducts: costingData.length,
        lowestMarginProducts,
        highestProfitProducts,
      },
    });
  } catch (err: any) {
    console.error('Get recipe costing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/reports/margins
router.get('/reports/margins', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);

    const products = db.prepare(`
      SELECT * FROM products WHERE bakery_id = ? ORDER BY name ASC
    `).all(bakeryId) as any[];

    const marginData = products.map((product: any) => {
      const recipeItems = db.prepare(`
        SELECT ri.*, i.cost_per_unit
        FROM recipe_items ri
        JOIN ingredients i ON ri.ingredient_id = i.id
        WHERE ri.product_id = ?
      `).all(product.id) as any[];

      let ingredientCost = 0;
      recipeItems.forEach((item: any) => {
        ingredientCost += (item.quantity_per_batch * item.cost_per_unit) / item.batch_size;
      });

      const margin = product.price > 0 ? ((product.price - ingredientCost) / product.price) * 100 : 0;

      return {
        name: product.name,
        margin: parseFloat(margin.toFixed(2)),
      };
    });

    res.json(marginData);
  } catch (err: any) {
    console.error('Get margins error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/reports/velocity - Sales velocity per product
router.get('/reports/velocity', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString();

    const products = db.prepare(`
      SELECT DISTINCT p.id, p.name
      FROM products p
      WHERE p.bakery_id = ?
      ORDER BY p.name ASC
    `).all(bakeryId) as any[];

    const velocityData = products.map((product: any) => {
      const sales = db.prepare(`
        SELECT CAST(strftime('%W', o.created_at) as INTEGER) as week, SUM(oi.quantity) as quantity
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.bakery_id = ? AND oi.product_id = ? AND o.created_at >= ?
        GROUP BY week
        ORDER BY week DESC
        LIMIT 4
      `).all(bakeryId, product.id, fourWeeksAgo) as any[];

      const weeks = sales.map(s => s.quantity || 0);
      let trend = 'flat';
      if (weeks.length >= 2) {
        if (weeks[0] > weeks[weeks.length - 1]) {
          trend = 'down';
        } else if (weeks[0] < weeks[weeks.length - 1]) {
          trend = 'up';
        }
      }

      return {
        name: product.name,
        trend,
        weekly: weeks,
      };
    });

    res.json(velocityData);
  } catch (err: any) {
    console.error('Get velocity error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/profitability - Comprehensive profitability dashboard data
router.get('/profitability', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);

    // Get all products with recipe costs
    const products = db.prepare('SELECT * FROM products WHERE bakery_id = ?').all(bakeryId) as any[];

    const productData = products.map((product: any) => {
      // Get recipe items for cost calculation
      const recipeItems = db.prepare(`
        SELECT ri.*, i.name as ingredient_name, i.unit, i.cost_per_unit
        FROM recipe_items ri
        JOIN ingredients i ON ri.ingredient_id = i.id
        WHERE ri.product_id = ?
      `).all(product.id) as any[];

      let ingredientCost = 0;
      recipeItems.forEach((item: any) => {
        item.cost = (item.quantity_per_batch * item.cost_per_unit) / item.batch_size;
        ingredientCost += item.cost;
      });

      const effectiveCost = recipeItems.length > 0 ? ingredientCost : product.cost;
      const margin = product.price > 0 ? ((product.price - effectiveCost) / product.price) * 100 : 0;
      const profit = product.price - effectiveCost;

      // Get total revenue and quantity sold
      const sales = db.prepare(`
        SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0) as revenue,
               COALESCE(SUM(oi.quantity), 0) as quantity_sold
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.bakery_id = ? AND oi.product_id = ?
      `).get(bakeryId, product.id) as any;

      // Monthly revenue (last 6 months)
      const monthlyRevenue = db.prepare(`
        SELECT strftime('%Y-%m', o.created_at) as month,
               COALESCE(SUM(oi.quantity * oi.unit_price), 0) as revenue,
               COALESCE(SUM(oi.quantity), 0) as quantity
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.bakery_id = ? AND oi.product_id = ? AND o.created_at >= date('now', '-6 months')
        GROUP BY month
        ORDER BY month
      `).all(bakeryId, product.id) as any[];

      const totalCOGS = sales.quantity_sold * effectiveCost;
      const grossProfit = sales.revenue - totalCOGS;

      return {
        id: product.id,
        name: product.name,
        category: product.category,
        price: product.price,
        effectiveCost,
        margin,
        profit,
        hasRecipe: recipeItems.length > 0,
        revenue: sales.revenue,
        quantitySold: sales.quantity_sold,
        totalCOGS,
        grossProfit,
        monthlyRevenue,
      };
    });

    // Category-level aggregation
    const categoryMap = new Map<string, any>();
    productData.forEach((p: any) => {
      const cat = p.category || 'outros';
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, {
          category: cat,
          productCount: 0,
          totalRevenue: 0,
          totalCOGS: 0,
          totalGrossProfit: 0,
          totalQuantity: 0,
          margins: [],
        });
      }
      const c = categoryMap.get(cat)!;
      c.productCount++;
      c.totalRevenue += p.revenue;
      c.totalCOGS += p.totalCOGS;
      c.totalGrossProfit += p.grossProfit;
      c.totalQuantity += p.quantitySold;
      c.margins.push(p.margin);
    });

    const categories = Array.from(categoryMap.values()).map(c => ({
      ...c,
      avgMargin: c.margins.length > 0 ? c.margins.reduce((a: number, b: number) => a + b, 0) / c.margins.length : 0,
      margins: undefined,
    }));

    // Monthly trends (last 6 months)
    const monthlyTrends = db.prepare(`
      SELECT strftime('%Y-%m', o.created_at) as month,
             COALESCE(SUM(o.total), 0) as revenue,
             COUNT(DISTINCT o.id) as order_count
      FROM orders o
      WHERE o.bakery_id = ? AND o.created_at >= date('now', '-6 months')
      GROUP BY month
      ORDER BY month
    `).all(bakeryId) as any[];

    // Overall summary
    const totalRevenue = productData.reduce((sum: number, p: any) => sum + p.revenue, 0);
    const totalCOGS = productData.reduce((sum: number, p: any) => sum + p.totalCOGS, 0);
    const overallGrossProfit = totalRevenue - totalCOGS;
    const overallMargin = totalRevenue > 0 ? (overallGrossProfit / totalRevenue) * 100 : 0;

    // Top/bottom performers
    const sortedByProfit = [...productData].filter((p: any) => p.revenue > 0).sort((a: any, b: any) => b.grossProfit - a.grossProfit);
    const topProducts = sortedByProfit.slice(0, 5);
    const bottomProducts = sortedByProfit.slice(-5).reverse();

    // Lowest margin products (with sales)
    const sortedByMargin = [...productData].filter((p: any) => p.revenue > 0).sort((a: any, b: any) => a.margin - b.margin);
    const lowestMarginProducts = sortedByMargin.slice(0, 5);

    res.json({
      summary: {
        totalRevenue,
        totalCOGS,
        grossProfit: overallGrossProfit,
        overallMargin,
        totalProducts: products.length,
        productsWithRecipes: productData.filter((p: any) => p.hasRecipe).length,
      },
      products: productData,
      categories,
      monthlyTrends,
      topProducts,
      bottomProducts,
      lowestMarginProducts,
    });
  } catch (err: any) {
    console.error('Profitability error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============= MARKETING ROUTES =============

// GET /baker/marketing/access - Check tier access to marketing features
router.get('/marketing/access', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const bakery = db.prepare('SELECT tier FROM bakeries WHERE id = ?').get(bakeryId) as any;

    if (!bakery) {
      return res.status(404).json({ error: 'Bakery not found' });
    }

    const tierAccess = {
      free: { campaigns: false, whatsapp: false, segmentation: false, analytics: false },
      starter: { campaigns: true, whatsapp: false, segmentation: true, analytics: false },
      pro: { campaigns: true, whatsapp: true, segmentation: true, analytics: true },
      enterprise: { campaigns: true, whatsapp: true, segmentation: true, analytics: true },
    };

    res.json({
      tier: bakery.tier,
      access: tierAccess[bakery.tier as keyof typeof tierAccess] || tierAccess.free,
    });
  } catch (err: any) {
    console.error('Marketing access error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/marketing/campaigns - List campaigns
router.get('/marketing/campaigns', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const status = (req.query.status as string) || '';
    const page = parseInt((req.query.page as string) || '1');
    const limit = parseInt((req.query.limit as string) || '20');
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM marketing_campaigns WHERE bakery_id = ?';
    const params: any[] = [bakeryId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const campaigns = db.prepare(query).all(...params) as any[];

    let countQuery = 'SELECT COUNT(*) as count FROM marketing_campaigns WHERE bakery_id = ?';
    const countParams: any[] = [bakeryId];

    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }

    const totalCount = db.prepare(countQuery).get(...countParams) as any;

    res.json({
      campaigns,
      pagination: {
        page,
        limit,
        total: totalCount.count,
        pages: Math.ceil(totalCount.count / limit),
      },
    });
  } catch (err: any) {
    console.error('Get campaigns error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /baker/marketing/campaigns - Create campaign
router.post('/marketing/campaigns', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const {
      name,
      type,
      channel,
      targetAudience,
      segmentId,
      messageTitle,
      messageBody,
      scheduledAt,
      budget,
    } = req.body;

    if (!name || !type || !channel) {
      return res.status(400).json({ error: 'Missing required fields: name, type, channel' });
    }

    const campaignId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO marketing_campaigns (
        id, bakery_id, name, type, status, channel, target_audience, segment_id,
        message_title, message_body, scheduled_at, budget, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      campaignId,
      bakeryId,
      name,
      type,
      'draft',
      channel,
      targetAudience || 'all',
      segmentId || null,
      messageTitle || null,
      messageBody || null,
      scheduledAt || null,
      budget || null,
      now,
      now
    );

    const campaign = db.prepare('SELECT * FROM marketing_campaigns WHERE id = ?').get(campaignId);
    res.status(201).json(campaign);
  } catch (err: any) {
    console.error('Create campaign error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /baker/marketing/campaigns/:id - Update campaign
router.put('/marketing/campaigns/:id', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const campaignId = req.params.id;
    const {
      name,
      type,
      channel,
      targetAudience,
      segmentId,
      messageTitle,
      messageBody,
      scheduledAt,
      status,
      budget,
    } = req.body as any;

    const campaign = db
      .prepare('SELECT * FROM marketing_campaigns WHERE id = ? AND bakery_id = ?')
      .get(campaignId, bakeryId) as any;

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const now = new Date().toISOString();

    db.prepare(`
      UPDATE marketing_campaigns SET
        name = ?,
        type = ?,
        channel = ?,
        target_audience = ?,
        segment_id = ?,
        message_title = ?,
        message_body = ?,
        scheduled_at = ?,
        status = ?,
        budget = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      name || campaign.name,
      type || campaign.type,
      channel || campaign.channel,
      targetAudience || campaign.target_audience,
      segmentId || campaign.segment_id,
      messageTitle || campaign.message_title,
      messageBody || campaign.message_body,
      scheduledAt || campaign.scheduled_at,
      status || campaign.status,
      budget !== undefined ? budget : campaign.budget,
      now,
      campaignId
    );

    const updated = db.prepare('SELECT * FROM marketing_campaigns WHERE id = ?').get(campaignId);
    res.json(updated);
  } catch (err: any) {
    console.error('Update campaign error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /baker/marketing/campaigns/:id - Delete campaign (draft only)
router.delete('/marketing/campaigns/:id', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const campaignId = req.params.id;

    const campaign = db
      .prepare('SELECT * FROM marketing_campaigns WHERE id = ? AND bakery_id = ?')
      .get(campaignId, bakeryId) as any;

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft campaigns can be deleted' });
    }

    db.prepare('DELETE FROM marketing_campaigns WHERE id = ?').run(campaignId);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Delete campaign error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /baker/marketing/campaigns/:id/send - Send campaign
router.post('/marketing/campaigns/:id/send', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);
    const campaignId = req.params.id;

    const campaign = db
      .prepare('SELECT * FROM marketing_campaigns WHERE id = ? AND bakery_id = ?')
      .get(campaignId, bakeryId) as any;

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Get Customers based on target audience
    let CustomerQuery = 'SELECT id FROM Customers WHERE bakery_id = ?';
    const CustomerParams: any[] = [bakeryId];

    if (campaign.target_audience !== 'all') {
      if (campaign.target_audience === 'new') {
        CustomerQuery += ' AND created_at >= datetime("now", "-30 days")';
      } else if (campaign.target_audience === 'vip') {
        CustomerQuery += ' AND total_spent > 500';
      } else if (campaign.target_audience === 'inactive') {
        CustomerQuery += ' AND created_at < datetime("now", "-90 days")';
      }
    }

    const Customers = db.prepare(CustomerQuery).all(...CustomerParams) as any[];
    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      // Create campaign messages for each Customer
      for (const Customer of Customers) {
        const messageId = uuidv4();
        const deliveryStatus = Math.random() > 0.15 ? 'delivered' : 'failed';
        const deliveredAt = deliveryStatus === 'delivered' ? now : null;

        db.prepare(`
          INSERT INTO campaign_messages (id, campaign_id, Customer_id, channel, status, sent_at, delivered_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(messageId, campaignId, Customer.id, campaign.channel, deliveryStatus, now, deliveredAt, now);
      }

      // Update campaign status and stats
      const deliveredCount = db
        .prepare('SELECT COUNT(*) as count FROM campaign_messages WHERE campaign_id = ? AND status = "delivered"')
        .get(campaignId) as any;

      db.prepare(`
        UPDATE marketing_campaigns SET
          status = ?,
          sent_at = ?,
          recipient_count = ?,
          delivered_count = ?,
          updated_at = ?
        WHERE id = ?
      `).run('sent', now, Customers.length, deliveredCount.count, now, campaignId);
    });

    transaction();

    const updated = db.prepare('SELECT * FROM marketing_campaigns WHERE id = ?').get(campaignId);
    res.json(updated);
  } catch (err: any) {
    console.error('Send campaign error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/marketing/segments - Get RFM segments
router.get('/marketing/segments', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);

    // Get all Customers for this bakery
    const Customers = db
      .prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM orders WHERE Customer_id = c.id) as order_count,
          (SELECT MAX(created_at) FROM orders WHERE Customer_id = c.id) as last_order_date,
          (SELECT COALESCE(SUM(total), 0) FROM orders WHERE Customer_id = c.id) as lifetime_value
        FROM Customers c
        WHERE c.bakery_id = ?
      `)
      .all(bakeryId) as any[];

    const now = new Date();
    const segments: Record<string, any> = {
      champions: { name: 'Champions', Customers: [], avg_value: 0, avg_frequency: 0, description: 'High Value, Frequent Purchases' },
      loyal: { name: 'Loyal', Customers: [], avg_value: 0, avg_frequency: 0, description: 'Consistent customers' },
      potentialLoyalists: { name: 'Potential Loyalists', Customers: [], avg_value: 0, avg_frequency: 0, description: 'High Potential' },
      newCustomers: { name: 'New Customers', Customers: [], avg_value: 0, avg_frequency: 0, description: 'Recently Acquired' },
      atRisk: { name: 'At Risk', Customers: [], avg_value: 0, avg_frequency: 0, description: 'Recently inactive' },
      hibernating: { name: 'Hibernating', Customers: [], avg_value: 0, avg_frequency: 0, description: 'Inactive for a Long Time' },
      lost: { name: 'Lost Customers', Customers: [], avg_value: 0, avg_frequency: 0, description: 'No Prolonged Activity' },
    };

    // Classify Customers
    for (const Customer of Customers) {
      const daysSinceLastOrder = Customer.last_order_date
        ? Math.floor((now.getTime() - new Date(Customer.last_order_date).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      const recency = daysSinceLastOrder;
      const frequency = Customer.order_count || 0;
      const monetary = Customer.lifetime_value || 0;

      let segment = 'lost';

      if (recency <= 30 && frequency >= 5 && monetary > 500) {
        segment = 'champions';
      } else if (recency <= 60 && frequency >= 3 && monetary > 300) {
        segment = 'loyal';
      } else if (recency <= 90 && frequency >= 2 && monetary > 100) {
        segment = 'potentialLoyalists';
      } else if (recency <= 30 && frequency <= 1) {
        segment = 'newCustomers';
      } else if (recency > 30 && recency <= 90 && frequency >= 1) {
        segment = 'atRisk';
      } else if (recency > 90 && recency <= 180) {
        segment = 'hibernating';
      }

      segments[segment].Customers.push({
        id: Customer.id,
        name: Customer.name,
        email: Customer.email,
        order_count: frequency,
        lifetime_value: monetary,
      });
    }

    // Calculate averages for each segment
    const response = Object.entries(segments).map(([key, segment]: [string, any]) => ({
      id: key,
      name: segment.name,
      description: segment.description,
      Customer_count: segment.Customers.length,
      avg_order_value: segment.Customers.length > 0
        ? segment.Customers.reduce((sum: number, c: any) => sum + c.lifetime_value, 0) / segment.Customers.length
        : 0,
      avg_frequency: segment.Customers.length > 0
        ? segment.Customers.reduce((sum: number, c: any) => sum + c.order_count, 0) / segment.Customers.length
        : 0,
      Customers: segment.Customers,
    }));

    res.json({ segments: response });
  } catch (err: any) {
    console.error('Get segments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /baker/marketing/analytics - Get marketing analytics dashboard
router.get('/marketing/analytics', (req: AuthRequest, res: any) => {
  try {
    const bakeryId = getBakeryId(req.user!.id);

    // Campaign overview
    const campaignStats = db
      .prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'sent' OR status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status IN ('scheduled', 'sent') THEN 1 ELSE 0 END) as active
        FROM marketing_campaigns
        WHERE bakery_id = ?
      `)
      .get(bakeryId) as any;

    // Delivery metrics
    const deliveryMetrics = db
      .prepare(`
        SELECT
          COUNT(*) as total_sent,
          SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
          SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as read
        FROM campaign_messages
        WHERE campaign_id IN (SELECT id FROM marketing_campaigns WHERE bakery_id = ?)
      `)
      .get(bakeryId) as any;

    // Campaign performance by type
    const performanceByType = db
      .prepare(`
        SELECT
          type,
          COUNT(*) as campaign_count,
          COALESCE(SUM(recipient_count), 0) as total_recipients,
          COALESCE(SUM(delivered_count), 0) as total_delivered,
          COALESCE(SUM(conversion_count), 0) as total_conversions,
          COALESCE(SUM(revenue_generated), 0) as total_revenue
        FROM marketing_campaigns
        WHERE bakery_id = ? AND (status = 'sent' OR status = 'completed')
        GROUP BY type
      `)
      .all(bakeryId) as any[];

    // Campaign performance over time (last 12 months)
    const performanceOverTime = db
      .prepare(`
        SELECT
          strftime('%Y-%m', created_at) as month,
          COUNT(*) as campaigns_created,
          SUM(CASE WHEN status IN ('sent', 'completed') THEN 1 ELSE 0 END) as campaigns_sent,
          COALESCE(SUM(revenue_generated), 0) as revenue
        FROM marketing_campaigns
        WHERE bakery_id = ? AND created_at >= datetime('now', '-12 months')
        GROUP BY strftime('%Y-%m', created_at)
        ORDER BY month DESC
      `)
      .all(bakeryId) as any[];

    // Channel breakdown
    const channelBreakdown = db
      .prepare(`
        SELECT
          channel,
          COUNT(*) as campaign_count,
          COALESCE(SUM(recipient_count), 0) as total_sent,
          COALESCE(SUM(delivered_count), 0) as total_delivered
        FROM marketing_campaigns
        WHERE bakery_id = ? AND (status = 'sent' OR status = 'completed')
        GROUP BY channel
      `)
      .all(bakeryId) as any[];

    const deliveryRate =
      deliveryMetrics.total_sent > 0
        ? parseFloat(((deliveryMetrics.delivered / deliveryMetrics.total_sent) * 100).toFixed(2))
        : 0;

    const readRate =
      deliveryMetrics.delivered > 0
        ? parseFloat(((deliveryMetrics.read / deliveryMetrics.delivered) * 100).toFixed(2))
        : 0;

    res.json({
      overview: {
        totalCampaigns: campaignStats.total || 0,
        activeCampaigns: campaignStats.active || 0,
        completedCampaigns: campaignStats.completed || 0,
      },
      deliveryMetrics: {
        totalSent: deliveryMetrics.total_sent || 0,
        delivered: deliveryMetrics.delivered || 0,
        read: deliveryMetrics.read || 0,
        deliveryRate,
        readRate,
      },
      performanceByType,
      performanceOverTime,
      channelBreakdown,
    });
  } catch (err: any) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

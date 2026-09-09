import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../bakery-webapp.db');

let db: Database.Database;

export function getDB(): Database.Database {
  if (!db) {
    try {
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
    } catch (err: any) {
      // If DB is corrupt, delete it and create fresh
      if (err.code === 'SQLITE_CORRUPT' || err.message?.includes('malformed')) {
        console.warn('Corrupt database detected — deleting and recreating...');
        try {
          if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
          if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
          if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
        } catch { /* ignore cleanup errors */ }
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
      } else {
        throw err;
      }
    }
  }
  return db;
}

function columnExists(tableName: string, columnName: string): boolean {
  try {
    db.prepare(`SELECT ${columnName} FROM ${tableName} LIMIT 0`).all();
    return true;
  } catch {
    return false;
  }
}

export function initDB(): void {
  db = getDB();

  // Check if subscriptions table exists and add missing columns
  try {
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subscriptions'").get();
    if (result) {
      // Table exists, check for and add missing columns
      if (!columnExists('subscriptions', 'billing_cycle')) {
        db.exec(`
          ALTER TABLE subscriptions ADD COLUMN billing_cycle TEXT CHECK(billing_cycle IN ('monthly', 'annual')) DEFAULT 'monthly';
        `);
      }
      if (!columnExists('subscriptions', 'annual_discount_applied')) {
        db.exec(`ALTER TABLE subscriptions ADD COLUMN annual_discount_applied INT DEFAULT 0;`);
      }
      if (!columnExists('subscriptions', 'next_billing_date')) {
        db.exec(`ALTER TABLE subscriptions ADD COLUMN next_billing_date TEXT;`);
      }
      if (!columnExists('subscriptions', 'trial_ends_at')) {
        db.exec(`ALTER TABLE subscriptions ADD COLUMN trial_ends_at TEXT;`);
      }
      if (!columnExists('subscriptions', 'payment_method_id')) {
        db.exec(`ALTER TABLE subscriptions ADD COLUMN payment_method_id TEXT;`);
      }
      if (!columnExists('subscriptions', 'failed_payment_count')) {
        db.exec(`ALTER TABLE subscriptions ADD COLUMN failed_payment_count INT DEFAULT 0;`);
      }
      if (!columnExists('subscriptions', 'grace_period_end')) {
        db.exec(`ALTER TABLE subscriptions ADD COLUMN grace_period_end TEXT;`);
      }
      if (!columnExists('subscriptions', 'updated_at')) {
        db.exec(`ALTER TABLE subscriptions ADD COLUMN updated_at TEXT;`);
      }
    }
  } catch {
    // Table doesn't exist, will be created below
  }

  // Check if billing_history table exists and add missing columns
  try {
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='billing_history'").get();
    if (result) {
      if (!columnExists('billing_history', 'description')) {
        db.exec(`ALTER TABLE billing_history ADD COLUMN description TEXT;`);
      }
    }
  } catch {
    // Table doesn't exist, will be created below
  }

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'baker')),
      phone TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  `);

  // Bakeries table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bakeries (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      logo_url TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      country TEXT,
      tier TEXT NOT NULL CHECK(tier IN ('free', 'starter', 'pro', 'enterprise')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'churned')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_bakeries_owner_id ON bakeries(owner_id);
    CREATE INDEX IF NOT EXISTS idx_bakeries_slug ON bakeries(slug);
    CREATE INDEX IF NOT EXISTS idx_bakeries_status ON bakeries(status);
    CREATE INDEX IF NOT EXISTS idx_bakeries_tier ON bakeries(tier);
  `);

  // Subscriptions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      bakery_id TEXT NOT NULL UNIQUE,
      tier TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'past_due', 'cancelled', 'trialing')),
      monthly_price REAL NOT NULL,
      started_at TEXT NOT NULL,
      current_period_end TEXT,
      cancelled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      billing_cycle TEXT CHECK(billing_cycle IN ('monthly', 'annual')) DEFAULT 'monthly',
      annual_discount_applied INT DEFAULT 0,
      next_billing_date TEXT,
      trial_ends_at TEXT,
      payment_method_id TEXT,
      failed_payment_count INT DEFAULT 0,
      grace_period_end TEXT,
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id),
      FOREIGN KEY (payment_method_id) REFERENCES baker_payment_methods(id)
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_bakery_id ON subscriptions(bakery_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_next_billing_date ON subscriptions(next_billing_date);
  `);

  // Subscription plans table
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      monthly_price REAL NOT NULL,
      annual_price REAL NOT NULL,
      features TEXT,
      max_products INT,
      max_Customers INT,
      max_orders_per_month INT,
      is_active INT DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subscription_plans_slug ON subscription_plans(slug);
    CREATE INDEX IF NOT EXISTS idx_subscription_plans_is_active ON subscription_plans(is_active);
  `);

  // Billing history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_history (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      bakery_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'BRL',
      billing_period_start TEXT,
      billing_period_end TEXT,
      payment_method TEXT CHECK(payment_method IN ('pix', 'credit_card', 'debit_card', 'boleto')),
      payment_reference TEXT,
      status TEXT CHECK(status IN ('pending', 'paid', 'failed', 'refunded', 'discount')) DEFAULT 'pending',
      invoice_number TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_history_subscription_id ON billing_history(subscription_id);
    CREATE INDEX IF NOT EXISTS idx_billing_history_bakery_id ON billing_history(bakery_id);
    CREATE INDEX IF NOT EXISTS idx_billing_history_status ON billing_history(status);
    CREATE INDEX IF NOT EXISTS idx_billing_history_created_at ON billing_history(created_at);
  `);

  // Baker payment methods table
  db.exec(`
    CREATE TABLE IF NOT EXISTS baker_payment_methods (
      id TEXT PRIMARY KEY,
      bakery_id TEXT NOT NULL,
      type TEXT CHECK(type IN ('pix', 'credit_card', 'debit_card', 'boleto')),
      label TEXT,
      is_default INT DEFAULT 0,
      details TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_baker_payment_methods_bakery_id ON baker_payment_methods(bakery_id);
    CREATE INDEX IF NOT EXISTS idx_baker_payment_methods_is_default ON baker_payment_methods(is_default);
  `);

  // Features table
  db.exec(`
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      tier_required TEXT NOT NULL CHECK(tier_required IN ('free', 'starter', 'pro', 'enterprise')),
      category TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_features_tier_required ON features(tier_required);
  `);

  // Products table
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      bakery_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      price REAL NOT NULL,
      cost REAL,
      image_url TEXT,
      is_active INT NOT NULL DEFAULT 1,
      prep_time_minutes INT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_products_bakery_id ON products(bakery_id);
    CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
  `);

  // Customers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS Customers (
      id TEXT PRIMARY KEY,
      bakery_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      notes TEXT,
      is_wholesale INT NOT NULL DEFAULT 0,
      company_name TEXT,
      total_orders INT NOT NULL DEFAULT 0,
      total_spent REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_Customers_bakery_id ON Customers(bakery_id);
    CREATE INDEX IF NOT EXISTS idx_Customers_is_wholesale ON Customers(is_wholesale);
  `);

  // Orders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      bakery_id TEXT NOT NULL,
      Customer_id TEXT NOT NULL,
      order_number TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'production', 'ready', 'delivered', 'cancelled')),
      total REAL NOT NULL,
      notes TEXT,
      delivery_date TEXT,
      delivery_type TEXT CHECK(delivery_type IN ('pickup', 'delivery')),
      payment_status TEXT NOT NULL CHECK(payment_status IN ('unpaid', 'partial', 'paid', 'refunded')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id) ON DELETE CASCADE,
      FOREIGN KEY (Customer_id) REFERENCES Customers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_bakery_id ON orders(bakery_id);
    CREATE INDEX IF NOT EXISTS idx_orders_Customer_id ON orders(Customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_delivery_date ON orders(delivery_date);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  `);

  // Order items table
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INT NOT NULL,
      unit_price REAL NOT NULL,
      notes TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
  `);

  // Ingredients/Inventory table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ingredients (
      id TEXT PRIMARY KEY,
      bakery_id TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      cost_per_unit REAL NOT NULL,
      stock REAL NOT NULL,
      min_stock REAL,
      category TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ingredients_bakery_id ON ingredients(bakery_id);
  `);

  // Employees table
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      bakery_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT,
      hourly_rate REAL,
      is_active INT NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_employees_bakery_id ON employees(bakery_id);
  `);

  // Notifications table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      is_read INT NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
  `);

  // Onboarding steps table
  db.exec(`
    CREATE TABLE IF NOT EXISTS onboarding_steps (
      id TEXT PRIMARY KEY,
      bakery_id TEXT NOT NULL,
      step TEXT NOT NULL,
      completed INT NOT NULL DEFAULT 0,
      completed_at TEXT,
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id) ON DELETE CASCADE,
      UNIQUE(bakery_id, step)
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_steps_bakery_id ON onboarding_steps(bakery_id);
  `);

  // Payments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      bakery_id TEXT NOT NULL,
      order_id TEXT,
      Customer_id TEXT,
      amount REAL NOT NULL,
      method TEXT NOT NULL CHECK(method IN ('pix', 'cash', 'card', 'other')),
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending', 'completed', 'failed', 'refunded')),
      reference TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (Customer_id) REFERENCES Customers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_payments_bakery_id ON payments(bakery_id);
    CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method);
    CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
  `);

  // Audit log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
  `);

  // Announcements table
  db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      target_tiers TEXT,
      is_active INT NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (author_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_announcements_is_active ON announcements(is_active);
  `);

  // Recipe items table
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipe_items (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      ingredient_id TEXT NOT NULL,
      quantity_per_batch REAL NOT NULL,
      batch_size INT NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_recipe_items_product_id ON recipe_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_recipe_items_ingredient_id ON recipe_items(ingredient_id);
  `);

  // Marketing campaigns table
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id TEXT PRIMARY KEY,
      bakery_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      target_audience TEXT NOT NULL DEFAULT 'all',
      segment_id TEXT,
      message_title TEXT,
      message_body TEXT,
      scheduled_at TEXT,
      sent_at TEXT,
      completed_at TEXT,
      budget REAL,
      recipient_count INT DEFAULT 0,
      delivered_count INT DEFAULT 0,
      read_count INT DEFAULT 0,
      conversion_count INT DEFAULT 0,
      revenue_generated REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_bakery_id ON marketing_campaigns(bakery_id);
    CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status);
    CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_created_at ON marketing_campaigns(created_at);
  `);

  // Customer segments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS Customer_segments (
      id TEXT PRIMARY KEY,
      bakery_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'auto',
      criteria TEXT,
      Customer_count INT DEFAULT 0,
      avg_order_value REAL DEFAULT 0,
      avg_frequency REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (bakery_id) REFERENCES bakeries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_Customer_segments_bakery_id ON Customer_segments(bakery_id);
  `);

  // Campaign messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_messages (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      Customer_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TEXT,
      delivered_at TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (Customer_id) REFERENCES Customers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_messages_campaign_id ON campaign_messages(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_messages_Customer_id ON campaign_messages(Customer_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_messages_status ON campaign_messages(status);
  `);

  // Global SaaS foundation. These additive migrations preserve existing bakery data.
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      country TEXT DEFAULT 'BR',
      state_province TEXT,
      city TEXT,
      address TEXT,
      postal_code TEXT,
      currency TEXT NOT NULL DEFAULT 'BRL',
      timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
      locale TEXT NOT NULL DEFAULT 'en-US',
      measurement_system TEXT NOT NULL DEFAULT 'metric',
      tax_model TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT,
      country TEXT,
      state_province TEXT,
      city TEXT,
      address TEXT,
      postal_code TEXT,
      timezone TEXT,
      currency TEXT,
      is_default INT NOT NULL DEFAULT 0,
      is_active INT NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      UNIQUE(organization_id, code)
    );
    CREATE TABLE IF NOT EXISTS user_organizations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      location_id TEXT,
      role TEXT NOT NULL DEFAULT 'staff',
      is_active INT NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
      UNIQUE(user_id, organization_id)
    );
    CREATE TABLE IF NOT EXISTS membership_locations (
      membership_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      is_active INT NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      PRIMARY KEY (membership_id, location_id),
      FOREIGN KEY (membership_id) REFERENCES user_organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (role, permission)
    );
    CREATE TABLE IF NOT EXISTS measurement_units (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system TEXT NOT NULL CHECK(system IN ('metric', 'imperial', 'neutral'))
    );
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      location_id TEXT,
      order_id TEXT,
      subscription_id TEXT,
      provider TEXT NOT NULL DEFAULT 'mAnnual',
      transaction_id TEXT,
      amount REAL NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
      payment_method TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      location_id TEXT,
      order_id TEXT,
      invoice_number TEXT NOT NULL,
      business_name TEXT,
      business_address TEXT,
      Customer_name TEXT,
      Customer_email TEXT,
      currency TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      payment_method TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(organization_id, invoice_number),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      ingredient_id TEXT,
      product_id TEXT,
      quantity REAL NOT NULL,
      movement_type TEXT NOT NULL,
      reference TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS stock_transfers (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      source_location_id TEXT NOT NULL,
      destination_location_id TEXT NOT NULL,
      ingredient_id TEXT,
      product_id TEXT,
      quantity REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'cancelled')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_payment_transactions_organization_id ON payment_transactions(organization_id);
    CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_id ON payment_transactions(order_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_organization_id ON invoices(organization_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_location_id ON stock_movements(location_id);
    CREATE INDEX IF NOT EXISTS idx_stock_transfers_organization_id ON stock_transfers(organization_id);
    CREATE INDEX IF NOT EXISTS idx_locations_organization_id ON locations(organization_id);
    CREATE INDEX IF NOT EXISTS idx_user_organizations_user_id ON user_organizations(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_organizations_organization_id ON user_organizations(organization_id);
  `);

  const addColumn = (table: string, column: string, definition: string) => {
    if (!columnExists(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };

  addColumn('users', 'organization_id', 'TEXT');
  addColumn('users', 'default_location_id', 'TEXT');
  addColumn('bakeries', 'organization_id', 'TEXT');
  for (const table of ['subscriptions', 'billing_history', 'baker_payment_methods', 'products', 'Customers', 'orders', 'ingredients', 'employees', 'onboarding_steps', 'payments', 'marketing_campaigns', 'Customer_segments']) {
    addColumn(table, 'organization_id', 'TEXT');
  }
  addColumn('audit_log', 'organization_id', 'TEXT');
  addColumn('announcements', 'organization_id', 'TEXT');
  addColumn('order_items', 'organization_id', 'TEXT');
  addColumn('recipe_items', 'organization_id', 'TEXT');
  addColumn('campaign_messages', 'organization_id', 'TEXT');
  addColumn('organizations', 'address_line1', 'TEXT');
  addColumn('organizations', 'address_line2', 'TEXT');
  addColumn('organizations', 'tax_name', 'TEXT');
  addColumn('organizations', 'tax_type', "TEXT DEFAULT 'Other'");
  addColumn('organizations', 'tax_rate', 'REAL DEFAULT 0');
  addColumn('organizations', 'tax_inclusive', 'INT DEFAULT 0');
  addColumn('organizations', 'legal_name', 'TEXT');
  addColumn('organizations', 'business_type', 'TEXT');
  addColumn('organizations', 'business_email', 'TEXT');
  addColumn('organizations', 'business_phone', 'TEXT');
  addColumn('organizations', 'website', 'TEXT');
  addColumn('organizations', 'onboarding_status', "TEXT DEFAULT 'completed'");
  addColumn('organizations', 'onboarding_completed', 'INT DEFAULT 1');
  addColumn('organizations', 'onboarding_step', 'INTEGER DEFAULT 10');
  db.exec('CREATE INDEX IF NOT EXISTS idx_organizations_onboarding_status ON organizations(onboarding_status);');
  addColumn('locations', 'address_line1', 'TEXT');
  addColumn('locations', 'address_line2', 'TEXT');
  addColumn('locations', 'phone', 'TEXT');
  addColumn('users', 'phone_e164', 'TEXT');
  addColumn('users', 'email_verified_at', 'TEXT');
  addColumn('users', 'password_reset_token_hash', 'TEXT');
  addColumn('users', 'password_reset_expires_at', 'TEXT');
  addColumn('bakeries', 'phone_e164', 'TEXT');
  addColumn('Customers', 'phone_e164', 'TEXT');
  for (const table of ['orders', 'ingredients', 'payments', 'marketing_campaigns', 'Customer_segments']) {
    addColumn(table, 'location_id', 'TEXT');
  }
  addColumn('orders', 'currency', "TEXT DEFAULT 'BRL'");
  addColumn('payments', 'currency', "TEXT DEFAULT 'BRL'");
  addColumn('billing_history', 'currency', "TEXT DEFAULT 'BRL'");
  addColumn('orders', 'total_minor', 'INTEGER');
  addColumn('payments', 'amount_minor', 'INTEGER');
  addColumn('billing_history', 'amount_minor', 'INTEGER');
  addColumn('products', 'price_minor', 'INTEGER');
  addColumn('products', 'cost_minor', 'INTEGER');
  addColumn('subscriptions', 'monthly_price_minor', 'INTEGER');
  addColumn('subscriptions', 'annual_price_minor', 'INTEGER');
  addColumn('orders', 'subtotal', 'REAL DEFAULT 0');
  addColumn('orders', 'discount', 'REAL DEFAULT 0');
  addColumn('orders', 'discount_type', "TEXT DEFAULT 'fixed'");
  addColumn('orders', 'discount_value', 'REAL DEFAULT 0');
  addColumn('orders', 'tax', 'REAL DEFAULT 0');
  addColumn('orders', 'tax_rate', 'REAL DEFAULT 0');
  addColumn('orders', 'tax_name', 'TEXT');
  addColumn('orders', 'tax_inclusive', 'INT DEFAULT 0');
  addColumn('orders', 'invoice_number', 'TEXT');
  addColumn('orders', 'payment_method', 'TEXT');
  addColumn('order_items', 'tax_amount', 'REAL DEFAULT 0');
  addColumn('order_items', 'total_minor', 'INTEGER');
  addColumn('payments', 'provider', "TEXT DEFAULT 'mAnnual'");
  addColumn('payments', 'transaction_id', 'TEXT');
  addColumn('payments', 'metadata', 'TEXT');
  addColumn('payments', 'amount_minor', 'INTEGER');

  // Backfill the tenant boundary for all existing bakery-owned records.
  db.exec(`
    INSERT OR IGNORE INTO organizations (id, name, slug, country, currency, timezone, locale, measurement_system, tax_model, created_at, updated_at)
    SELECT 'org-' || id, name, 'legacy-' || id, COALESCE(country, 'BR'), 'BRL', 'America/Sao_Paulo', 'en-US', 'metric', 'none', created_at, updated_at
    FROM bakeries;
    UPDATE bakeries SET organization_id = 'org-' || id WHERE organization_id IS NULL;
    INSERT OR IGNORE INTO locations (id, organization_id, name, code, country, is_default, created_at, updated_at)
    SELECT 'loc-' || id, organization_id, name || ' - Main', 'main', country, 1, created_at, updated_at
    FROM bakeries WHERE organization_id IS NOT NULL;
    UPDATE users SET organization_id = b.organization_id, default_location_id = 'loc-' || b.id
      FROM bakeries b WHERE b.owner_id = users.id AND users.organization_id IS NULL;
  `);
  for (const table of ['subscriptions', 'billing_history', 'baker_payment_methods', 'products', 'Customers', 'orders', 'ingredients', 'employees', 'onboarding_steps', 'payments', 'marketing_campaigns', 'Customer_segments']) {
    db.exec(`UPDATE ${table} SET organization_id = (SELECT organization_id FROM bakeries WHERE bakeries.id = ${table}.bakery_id) WHERE organization_id IS NULL`);
  }
  db.exec(`
    UPDATE order_items SET organization_id = (SELECT organization_id FROM orders WHERE orders.id = order_items.order_id) WHERE organization_id IS NULL;
    UPDATE recipe_items SET organization_id = (SELECT organization_id FROM products WHERE products.id = recipe_items.product_id) WHERE organization_id IS NULL;
    UPDATE campaign_messages SET organization_id = (SELECT organization_id FROM marketing_campaigns WHERE marketing_campaigns.id = campaign_messages.campaign_id) WHERE organization_id IS NULL;
  `);
  db.exec(`
    UPDATE audit_log SET organization_id = (SELECT organization_id FROM users WHERE users.id = audit_log.user_id) WHERE organization_id IS NULL;
    UPDATE announcements SET organization_id = (SELECT organization_id FROM users WHERE users.id = announcements.author_id) WHERE organization_id IS NULL;
  `);
  db.exec(`
    UPDATE orders SET location_id = 'loc-' || bakery_id WHERE location_id IS NULL;
    UPDATE orders
    SET location_id = (
      SELECT l.id
      FROM locations l
      JOIN bakeries b ON b.organization_id = l.organization_id
      WHERE b.id = orders.bakery_id AND l.is_active = 1
      ORDER BY l.is_default DESC, l.created_at ASC
      LIMIT 1
    )
    WHERE location_id = 'loc-' || bakery_id
      AND EXISTS (
        SELECT 1
        FROM locations l
        JOIN bakeries b ON b.organization_id = l.organization_id
        WHERE b.id = orders.bakery_id AND l.is_active = 1
      );
    UPDATE ingredients SET location_id = 'loc-' || bakery_id WHERE location_id IS NULL;
    UPDATE payments SET location_id = 'loc-' || bakery_id WHERE location_id IS NULL;
    UPDATE marketing_campaigns SET location_id = 'loc-' || bakery_id WHERE location_id IS NULL;
    UPDATE Customer_segments SET location_id = 'loc-' || bakery_id WHERE location_id IS NULL;
    UPDATE orders SET currency = COALESCE((SELECT currency FROM organizations WHERE organizations.id = orders.organization_id), 'BRL') WHERE currency IS NULL;
    UPDATE payments SET currency = COALESCE((SELECT currency FROM organizations WHERE organizations.id = payments.organization_id), 'BRL') WHERE currency IS NULL;
    UPDATE billing_history SET currency = COALESCE((SELECT currency FROM organizations WHERE organizations.id = billing_history.organization_id), 'BRL') WHERE currency IS NULL;
    UPDATE orders SET total_minor = ROUND(total * 100) WHERE total_minor IS NULL;
    UPDATE payments SET amount_minor = ROUND(amount * 100) WHERE amount_minor IS NULL;
    UPDATE order_items SET total_minor = ROUND(quantity * unit_price * 100) WHERE total_minor IS NULL;
    UPDATE billing_history SET amount_minor = ROUND(amount * 100) WHERE amount_minor IS NULL;
    UPDATE products SET price_minor = ROUND(price * 100), cost_minor = ROUND(COALESCE(cost, 0) * 100) WHERE price_minor IS NULL;
    UPDATE subscriptions SET monthly_price_minor = ROUND(monthly_price * 100), annual_price_minor = ROUND(monthly_price * 12 * 100) WHERE monthly_price_minor IS NULL;
    UPDATE users SET phone_e164 = phone WHERE phone_e164 IS NULL;
    UPDATE bakeries SET phone_e164 = phone WHERE phone_e164 IS NULL;
    UPDATE Customers SET phone_e164 = phone WHERE phone_e164 IS NULL;
    UPDATE organizations SET onboarding_status = 'completed', onboarding_completed = 1, onboarding_step = 10
      WHERE onboarding_status IS NULL OR onboarding_status = '';
  `);
  db.exec(`
    INSERT OR IGNORE INTO user_organizations (id, user_id, organization_id, location_id, role, created_at)
    SELECT 'membership-' || u.id, u.id, u.organization_id, u.default_location_id,
      CASE WHEN u.role = 'admin' THEN 'platform_admin' ELSE 'owner' END, u.created_at
    FROM users u WHERE u.organization_id IS NOT NULL;
    INSERT OR IGNORE INTO membership_locations (membership_id, location_id, created_at)
    SELECT uo.id, uo.location_id, uo.created_at FROM user_organizations uo WHERE uo.location_id IS NOT NULL;
    INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
      ('platform_admin', '*'),
      ('owner', 'orders.create'), ('owner', 'orders.read'), ('owner', 'orders.update'), ('owner', 'orders.delete'),
      ('owner', 'products.manage'), ('owner', 'Customers.manage'), ('owner', 'inventory.manage'), ('owner', 'payments.manage'), ('owner', 'marketing.manage'), ('owner', 'locations.view'), ('owner', 'locations.manage'), ('owner', 'staff.view'), ('owner', 'staff.manage'), ('owner', 'settings.manage'),
      ('manager', 'orders.create'), ('manager', 'orders.read'), ('manager', 'orders.update'), ('manager', 'products.manage'), ('manager', 'Customers.manage'), ('manager', 'locations.view'), ('manager', 'staff.view'),
      ('baker', 'orders.create'), ('baker', 'orders.read'), ('baker', 'orders.update'), ('baker', 'production.manage'),
      ('cashier', 'orders.read'), ('cashier', 'payments.manage'),
      ('inventory_manager', 'inventory.manage'), ('accountant', 'payments.manage'), ('accountant', 'reports.read'),
      ('marketing_manager', 'marketing.manage'), ('staff', 'orders.read'), ('staff', 'orders.view'),
      ('owner', 'orders.view'), ('owner', 'inventory.view'), ('owner', 'production.view'), ('owner', 'payments.view'), ('owner', 'reports.view'), ('owner', 'Customers.view'), ('owner', 'products.view'),
      ('manager', 'orders.view'), ('manager', 'inventory.view'), ('manager', 'production.view'), ('manager', 'payments.view'), ('manager', 'reports.view'), ('manager', 'Customers.view'), ('manager', 'products.view'),
      ('baker', 'orders.view'), ('baker', 'production.view'), ('cashier', 'orders.view'), ('cashier', 'payments.view'), ('inventory_manager', 'inventory.view'), ('accountant', 'reports.view'), ('marketing_manager', 'Customers.view');
    INSERT OR IGNORE INTO measurement_units (code, name, system) VALUES
      ('g', 'Gram', 'metric'), ('kg', 'Kilogram', 'metric'), ('ml', 'Milliliter', 'metric'),
      ('L', 'Liter', 'metric'), ('oz', 'Ounce', 'imperial'), ('lb', 'Pound', 'imperial'),
      ('piece', 'Piece', 'neutral'), ('dozen', 'Dozen', 'neutral');
  `);
}

export function getBakeryForUser(userId: string): any {
  const db = getDB();
  return db.prepare(`
    SELECT b.* FROM bakeries b
    LEFT JOIN users u ON u.organization_id = b.organization_id
    WHERE b.owner_id = ? OR u.id = ?
    ORDER BY CASE WHEN b.owner_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(userId, userId, userId);
}

export function getOrganizationForUser(userId: string): any {
  const db = getDB();
  return db.prepare(`
    SELECT o.*, uo.role, uo.location_id,
           l.name AS location_name, l.timezone AS location_timezone
    FROM user_organizations uo
    JOIN organizations o ON o.id = uo.organization_id
    LEFT JOIN locations l ON l.id = uo.location_id
    WHERE uo.user_id = ? AND uo.is_active = 1
    ORDER BY uo.created_at ASC LIMIT 1
  `).get(userId);
}

export function getLocationForUser(userId: string, locationId?: string): any {
  const db = getDB();
  return db.prepare(`
    SELECT l.* FROM locations l
    JOIN user_organizations uo ON uo.organization_id = l.organization_id
    WHERE uo.user_id = ? AND uo.is_active = 1 AND l.is_active = 1
      AND (? IS NULL OR l.id = ?)
    ORDER BY l.is_default DESC, l.created_at ASC LIMIT 1
  `).get(userId, locationId || null, locationId || null);
}

export function hasPermission(userId: string, permission: string): boolean {
  const db = getDB();
  const permissions = (db.prepare(`
    SELECT rp.permission FROM user_organizations uo
    JOIN role_permissions rp ON rp.role = uo.role
    WHERE uo.user_id = ? AND uo.is_active = 1
  `).all(userId) as any[]).map((row) => row.permission);
  const namespace = permission.split('.')[0];
  return permissions.includes('*') || permissions.includes(permission) || permissions.includes(`${namespace}.manage`);
}

export function getLocationsForUser(userId: string): any[] {
  const db = getDB();
  return db.prepare(`
    SELECT l.*, uo.role, CASE WHEN uo.location_id = l.id THEN 1 ELSE 0 END AS is_current
    FROM locations l
    JOIN user_organizations uo ON uo.organization_id = l.organization_id AND uo.user_id = ? AND uo.is_active = 1
    LEFT JOIN membership_locations ml ON ml.membership_id = uo.id AND ml.location_id = l.id AND ml.is_active = 1
    WHERE l.is_active = 1 AND (uo.role = 'owner' OR uo.role = 'manager' OR uo.role = 'platform_admin' OR ml.location_id IS NOT NULL)
    ORDER BY is_current DESC, l.is_default DESC, l.name ASC
  `).all(userId) as any[];
}

export function getPermissionsForUser(userId: string): string[] {
  const db = getDB();
  return (db.prepare(`
    SELECT DISTINCT rp.permission FROM user_organizations uo
    JOIN role_permissions rp ON rp.role = uo.role
    WHERE uo.user_id = ? AND uo.is_active = 1
  `).all(userId) as any[]).map((row) => row.permission);
}

export function canAccessLocation(userId: string, locationId: string): boolean {
  return getLocationsForUser(userId).some((location) => location.id === locationId);
}

export function recordAudit(userId: string, action: string, organizationId?: string, locationId?: string, targetType?: string, targetId?: string, details?: Record<string, unknown>): void {
  getDB().prepare(`INSERT INTO audit_log (id, user_id, organization_id, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), userId, organizationId || null, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null, new Date().toISOString());
}

export default getDB;

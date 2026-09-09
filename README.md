# bakery-webapp

bakery-webapp is a global, multi-tenant bakery and small-business operations SaaS. Bakery owners, managers, bakers, cashiers, inventory managers, accountants, and marketing staff can manage daily business operations from one workspace. Platform administrators can manage organizations, subscriptions, onboarding, analytics, announcements, and audit activity.

The application keeps SQLite and `better-sqlite3`, uses an additive migration strategy, and preserves the existing bakery-compatible data model through `bakery_id` while adding organization and location ownership.

## Core Features

- JWT authentication, registration, bcrypt password hashing, and protected routes.
- Organization and tenant isolation.
- Multiple locations per organization and authorized location switching.
- Organization memberships, staff management, role assignments, and permissions.
- Business onboarding wizard for new organizations.
- Products, recipes, ingredients, inventory, stock movements, and stock transfers.
- Orders, order items, customers, production workflow, and mobile baker workflow.
- Payments, payment transactions, manual payment-provider abstraction, invoices, receipts, taxes, and discounts.
- Subscription plans, subscription billing history, payment methods, and admin subscription controls.
- Profitability, reports, analytics, marketing campaigns, customer segments, and notifications.
- Admin dashboard, client management, onboarding monitoring, announcements, and audit logs.
- Global currency, locale, timezone, international address, phone, tax, and measurement foundations.

## International Support

Organization settings support country, state/province, city, address lines, postal code, currency, timezone, locale, measurement system, and tax configuration. Locations inherit organization settings by default and may override timezone or currency when configured.

Supported locale examples include `en-US`, `en-GB`, and `en-PK`. The frontend exposes centralized formatters in `client/src/lib/utils.ts`:

- `formatCurrency()`
- `formatDate()`
- `formatTime()`
- `formatNumber()`
- `toMinorUnits()` and `fromMinorUnits()`

Formatting reads the active organization's currency, locale, and timezone. No exchange-rate conversion is implemented. Phone data is preserved and also has international-safe `phone_e164` fields. Address data supports country-neutral fields.

Tax settings support `VAT`, `GST`, `Sales Tax`, and `Other`, with a configurable name, rate, and inclusive/exclusive flag. This is a foundation, not a country-specific compliance engine.

## Architecture

```text
Platform
└── Organization / Tenant
    ├── Locations
    ├── Users and Memberships
    ├── Roles and Permissions
    └── Business Data
        ├── Orders, Customers, Products, Recipes
        ├── Inventory, Movements, Transfers, Production
        ├── Payments, Transactions, Invoices
        └── Reports, Marketing, Subscriptions
```

The React/Vite client calls the Express API through same-origin `/api` requests. The server resolves the authenticated user, organization, membership, role, and active location before protected operations. Existing `bakery_id` filters remain in current routes for compatibility, while organization and location identifiers are stored and validated by the backend.

## Tech Stack

### Frontend

- React 18
- TypeScript
- Vite
- React Router 6
- Tailwind CSS and PostCSS
- Recharts
- Lucide React
- date-fns

### Backend

- Node.js
- Express
- TypeScript
- SQLite
- better-sqlite3
- JSON Web Tokens through `jsonwebtoken`
- bcryptjs
- CORS
- UUID
- tsx for development

## Project Structure

```text
bakery-webapp/
├── client/
│   ├── src/
│   │   ├── components/          # Shared layouts and UI components
│   │   ├── contexts/            # Auth and organization frontend state
│   │   ├── lib/                 # API client and globalization/finance utilities
│   │   ├── pages/admin/         # Platform administration screens
│   │   ├── pages/baker/         # Baker workspace screens
│   │   ├── types/               # Frontend domain types
│   │   ├── App.tsx              # Protected application routes
│   │   ├── index.css            # Tailwind and shared styles
│   │   ├── main.tsx             # Client entry point
│   │   └── vite-env.d.ts        # Vite and CSS type declarations
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── vite.config.ts
├── server/
│   ├── src/
│   │   ├── db/index.ts          # SQLite schema, migrations, and tenant backfills
│   │   ├── db/seed.ts           # Demo data and plans
│   │   ├── lib/finance.ts       # Tax, discount, money, provider, invoice helpers
│   │   ├── middleware/          # Auth, RBAC, and permission middleware
│   │   ├── routes/              # Auth, admin, baker, mobile, organization, onboarding, subscriptions
│   │   └── index.ts             # Express bootstrap and health checks
│   ├── package.json
│   └── tsconfig.json
├── .vscode/settings.json        # Tailwind CSS validator configuration
├── package.json                 # Root scripts
├── Procfile                    # Production process command
├── railway.json                # Railway build/deploy configuration
└── README.md
```

## Database Architecture

Important SQLite tables include:

- `users`, `organizations`, `locations`, `user_organizations`, `membership_locations`
- `role_permissions`, `measurement_units`
- `bakeries`, `products`, `Customers`, `orders`, `order_items`
- `ingredients`, `recipe_items`, `employees`, `onboarding_steps`
- `stock_movements`, `stock_transfers`
- `payments`, `payment_transactions`, `invoices`
- `subscriptions`, `subscription_plans`, `billing_history`, `baker_payment_methods`
- `marketing_campaigns`, `Customer_segments`, `campaign_messages`
- `notifications`, `audit_log`, `announcements`, and `features`

Organization-owned records store `organization_id`. Operational records such as orders, ingredients, payments, marketing records, and Customer segments also store `location_id` where applicable. Existing bakery-owned data is backfilled from `bakeries.organization_id` and default locations.

## RBAC and Security Model

Backward-compatible user roles remain `admin` and `baker`. Organization membership roles include:

- `platform_admin`
- `owner`
- `manager`
- `baker`
- `cashier`
- `inventory_manager`
- `accountant`
- `marketing_manager`
- `staff`

Granular permissions include order, inventory, production, payment, report, Customer, product, location, staff, and settings permissions. Reusable middleware is provided through `requirePermission("orders.create")`. Namespace-level permissions such as `inventory.manage` also satisfy related granular permissions.

Location switching uses `POST /api/organization/active-location` and validates membership access on the server. Client-supplied organization IDs, bakery IDs, roles, and unauthorized location IDs are not used as ownership authority. Platform administrators are kept separate from organization staff management.

## Finance Architecture

Financial calculations use integer minor-unit helpers for new calculations and retain legacy decimal columns for compatibility. The finance layer provides:

- Tax calculation for VAT, GST, Sales Tax, and Other.
- Tax-inclusive and tax-exclusive pricing.
- Fixed and percentage discounts.
- Organization currency ownership for orders, payments, invoices, and subscription billing.
- Provider-neutral `payment_transactions` with provider, transaction ID, amount, currency, status, payment method, metadata, and timestamps.
- A `PaymentProvider` interface and mAnnual provider implementation without gateway integration.
- Organization-specific invoice numbering.
- Standard transaction states: `pending`, `paid`, `failed`, `refunded`, and `cancelled`.
- Separate bakery/Customer payments from bakery-webapp subscription billing.

## Onboarding

New baker registration creates the following chain:

```text
Account → Organization → Default Location → Owner Membership
```

The onboarding wizard is available at `/onboarding` and follows:

```text
Business → Region → Localization → Tax → Location → Staff → Products → Inventory → Complete
```

Business, region, localization, tax, and primary-location settings are saved through the owner-authorized onboarding API. Staff, products, and inventory setup are optional and can be skipped for later completion in the main workspace. Onboarding progress is stored in the organization with `onboarding_status`, `onboarding_completed`, and `onboarding_step`. Existing organizations with data are marked complete during migration and are not forced through onboarding.

Onboarding endpoints:

- `GET /api/onboarding` - Read authenticated organization onboarding state.
- `PUT /api/onboarding` or `PATCH /api/onboarding` - Save progress and settings.
- `POST /api/onboarding/complete` - Complete onboarding as the organization owner.

Onboarding mutation is owner-only. Organization identity is resolved from the authenticated membership; client-supplied organization IDs are not trusted. The wizard resumes from the server-side `onboarding_step` after refresh.

## Authentication and Security

JWT verification is centralized in the authentication middleware. Passwords use bcryptjs. Invalid credentials return a generic response, expired or malformed tokens return `401`, and protected APIs require authentication. Login and registration are protected by a lightweight in-memory limit of 30 requests per IP per minute. Password reset and email verification fields exist as a database foundation only; no email delivery or public token workflow is implemented.

Organization APIs enforce membership, role, permission, and location access server-side. Platform admins are separate from organization staff roles. Passwords, tokens, reset secrets, and JWT secrets are not logged.

The server sends `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and a compatible content security policy. CORS allows local development origins and uses `FRONTEND_URL` for configured production origins.

## Installation

### Requirements

- Node.js 18 or newer
- npm 9 or newer

### Install all dependencies

From the project root:

```bash
npm run install:all
```

Or install packages separately:

```bash
npm install
cd server && npm install
cd ../client && npm install
```

### Development

Start the client and server together:

```bash
npm run dev
```

Services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

The Vite server proxies `/api` to the backend.

Start separately when needed:

```bash
npm run dev:server
npm run dev:client
```

## Environment Variables

The server reads these variables:

| Variable | Development default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Express listening port. |
| `JWT_SECRET` | Development fallback exists | JWT signing secret. Required as a strong secret in production. |
| `FRONTEND_URL` | CORS allows local setup | Allowed frontend origin for production CORS. |

The SQLite path is currently defined by the server database module as `server/bakery-webapp.db`; there is no `DATABASE_PATH` variable in the current implementation.

PowerShell example:

```powershell
$env:PORT = "3000"
$env:JWT_SECRET = "replace-with-a-long-random-production-secret"
$env:FRONTEND_URL = "https://your-domain.example"
```

Never commit `.env`, `.env.local`, passwords, tokens, API keys, or production secrets.

## Database Migrations and Seed Data

Database initialization runs from `server/src/db/index.ts`. Schema changes are additive and use `CREATE TABLE IF NOT EXISTS` and guarded `ALTER TABLE` operations. Existing organizations, locations, users, memberships, orders, payments, invoices, inventory, and subscriptions are preserved and backfilled.

The server automatically seeds an empty database. The development seed creates demo bakeries, users, products, Customers, recipes, inventory, orders, payments, plans, and related records.

Build and run the compiled seed:

```bash
npm run build:server
npm run seed
```

Development seed:

```bash
cd server
npm run seed:dev
```

Do not delete or reset the production database. For local-only fresh data, stop the server and remove the local SQLite database and its `-wal`/`-shm` files before starting again.

## ## API Overview

All API routes are mounted under `/api`:

- `/api/health` and `/health` - Basic server/database health checks.
- `/api/auth` - Registration, login, current user, and authentication.
- `/api/onboarding` - Owner onboarding state and progress updates.
- `/api/organization` - Organization context, locations, staff, active-location switching, and stock transfers.
- `/api/admin` - Platform administration, client management, analytics, announcements, onboarding, audit, and settings.
- `/api/baker` - Bakery dashboard, orders, products, Customers, inventory, employees, payments, reports, profile, marketing, recipes, and profitability.
- `/api/mobile` - Mobile baker dashboard and order workflow.
- `/api/subscriptions` - Plans, current subscriptions, payment methods, billing history, cancellation, and admin billing.

Important organization endpoints include:

- `GET /api/organization/context`
- `GET/POST /api/organization/locations`
- `PUT /api/organization/locations/:id`
- `POST /api/organization/active-location`
- `GET/POST /api/organization/staff`
- `PUT /api/organization/staff/:userId`
- `GET/POST /api/organization/stock-transfers`
- `PUT /api/organization/stock-transfers/:id/status`

## Production Deployment

The project is configured for Railway through [railway.json](railway.json) and [Procfile](Procfile).

Build everything:

```bash
npm run build
```

This runs the client and server builds. Start the production server:

```bash
npm start
```

Railway uses:

```text
Build: npm run install:all && npm run build
Start: npm start
```

Set a strong `JWT_SECRET` and an appropriate `FRONTEND_URL` in the production environment. Railway supplies `PORT`.

## Development Workflow

```bash
npm run dev             # Client and server
npm run build           # Client and server production builds
npm run build:client   # Client build only
npm run build:server   # Server build only
npm run seed            # Run compiled development seed
npm start               # Start compiled production server
```

Validation commands:

```bash
cd client
npm run build

cd ../server
npx tsc --noEmit
```

MAnnually test registration/onboarding, organization settings, location switching, staff roles, order and payment creation, inventory transfers, taxes, discounts, invoices, subscription separation, and cross-tenant access denial.

Recommended mAnnual checklist:

- Register, login, logout, and confirm generic authentication errors.
- Confirm a new organization, owner membership, and default location are created.
- Complete onboarding, refresh at each step, skip optional steps, and verify dashboard redirect.
- Verify existing organizations bypass onboarding.
- Test country, currency, locale, timezone, measurement, address, phone, tax, and discount settings.
- Create and switch locations; attempt unauthorized location access.
- Create staff, assign roles/locations, deactivate staff, and verify RBAC restrictions.
- Test orders, products, recipes, inventory, stock movements, transfers, payments, invoices, reports, marketing, subscriptions, admin, and mobile workflows.
- Attempt cross-tenant access and verify `401`/`403` responses.
- Check `/health`, `/api/health`, rate limiting, and safe unexpected-error responses.

## Security

- Passwords use bcryptjs hashing.
- JWT bearer tokens protect API routes.
- Authentication-sensitive routes have basic rate limiting.
- Security headers include content-type, frame, and referrer protections.
- CORS uses `FRONTEND_URL` when configured.
- Organization and location access is resolved server-side.
- RBAC and permission middleware protect organization operations.
- API errors return generic messages for unexpected server failures while server logs retain details.
- Audit data includes organization fields where available; secrets and passwords are not logged by the application flows.

## Phase History

### Phase 1: Global SaaS Foundation

Added organizations, locations, memberships, tenant fields, role permissions, organization settings, currency/timezone/locale foundations, and safe SQLite backfills.

### Phase 2: Globalization and Localization Foundation

Added locale-aware formatting, international address and phone fields, tax settings, measurement units, organization currency defaults, timezone-aware formatter support, and minor-unit money fields.

### Phase 3: Global Finance and Payment Foundation

Added tax and discount calculations, minor-unit order totals, invoices, payment transactions, provider abstraction, financial statuses, currency-aware records, and subscription billing separation.

### Phase 4: Global Business Operations and Multi-Location Foundation

Added authorized location assignments and switching, staff management, granular RBAC, location-aware orders and payments, stock movements, stock transfers, and organization context APIs.

### Phase 5: Production Readiness, Business Onboarding, and Documentation

Added resumable owner onboarding, business and localization setup, security headers, auth rate limiting, safer API errors, health checks, and this complete project documentation.

## Future Roadmap

Not implemented yet:

- PostgreSQL migration.
- Stripe, PayPal, Razorpay, or other payment gateway integrations.
- Payment gateway webhooks.
- Exchange-rate and currency conversion support.
- Full country-specific tax compliance.
- Full accounting or ERP integration.
- Advanced warehouse management.
- Barcode and QR systems.
- PWA/offline mode.
- Full translation/i18n, Urdu/Arabic translations, and RTL.
- Advanced payroll.
- Complex invitation and email infrastructure.

## Functional Bug-Fix Audit and Payment Workflow Repair

This project was audited for real production-readiness issues beyond a successful TypeScript build. The targeted fix work focused on end-to-end functionality rather than cosmetic cleanup.

### Payment registration bug

The Payments screen was using a modal form that did not reliably provide a clear, actionable save path and the client-side validation did not match the backend contract. The real issues were:

- the frontend form validation required a Customer and an amount but the product requirements and API contract define Customer and Order as optional fields, with amount and method as the required inputs;
- the layout did not clearly emphasize a primary create action and a secondary cancellation action in a way that matched the app’s action patterns;
- the backend `GET /api/baker/payments` response shape did not match what the Payments page was reading, so the UI summary fields could be undefined even when the list was working;
- the backend payment creation route was not validating the amount and method consistently for invalid requests.

### Root cause and fix

The fix was applied at the actual route and form boundaries:

- The payment form now validates only the real required fields: positive numeric amount and payment method.
- The amount label uses the organization currency from the authenticated context instead of hardcoded USD.
- The modal exposes a clear primary action: `Add Payment`.
- The modal exposes a clear secondary action: `Cancel`.
- The form keeps itself open on API validation errors and preserves the user’s entered values.
- Successful submissions close the modal, refresh the payment list, and show a success banner.
- The server `GET /api/baker/payments` response now returns the summary totals at the top level, matching the frontend contract.
- The server payment creation route now validates numeric amount > 0, method values, order ownership, and customer ownership before inserting a payment.

### Validation checklist performed

The following checks were run against the live application:

- `npm run build` for the full repository.
- `git diff --check` for whitespace and merge-marker issues.
- Live login to a seeded baker account.
- Fetch of `/api/baker/payments` and verification of summary totals.
- Payment creation through `/api/baker/payments` with a valid customer and amount.
- Payment list refresh and new record verification.
- Invalid payment payload rejection with a `400` response and no record created.
- Existing records remain readable and the broader payment list still functions.

### Operational notes

- Use the seeded demo account `maria@jumaboss.com / demo123` for local validation.
- The app uses same-origin `/api` calls from the client and resolves organization/location access server-side.
- Payment amounts are kept in the organization’s configured currency and use the project’s minor-unit helper flow.
- No duplicate payment endpoint was created; the existing `/api/baker/payments` route was fixed and reused.

## Backend and Frontend Summary

### Frontend modules

- `client/src/App.tsx` - route protection and workspace redirects.
- `client/src/contexts/AuthContext.tsx` - user, org, and token state.
- `client/src/lib/api.ts` - shared /api fetch wrapper.
- `client/src/pages/baker/Payments.tsx` - payment list and payment registration modal.
- Other baker/admin screens follow the same same-origin API design.

### Backend modules

- `server/src/index.ts` - Express bootstrap, health checks, static serving, API mount points.
- `server/src/db/index.ts` - database schema, migrations, and organization/location backfill logic.
- `server/src/routes/auth.ts` - login, register, and user state.
- `server/src/routes/admin.ts` - admin dashboard and client operations.
- `server/src/routes/baker.ts` - core bakery operations including payments, orders, products, inventory, Customers, reports, and profitability.
- `server/src/routes/organization.ts` - location and org context logic.
- `server/src/middleware/auth.ts` and `server/src/middleware/rbac.ts` - token verification and role/permission enforcement.

## Local Run Commands

```bash
npm install
npm run install:all
npm run dev
npm run build
npm run build:client
npm run build:server
npm start
```

## Production Notes

- Create a secure `JWT_SECRET`.
- Set `FRONTEND_URL` when deploying behind a configured domain.
- Keep the SQLite database local to the backend unless a managed database is added later.
- Do not expose demo credentials in production.
- Keep sensitive users and tokens out of logs.

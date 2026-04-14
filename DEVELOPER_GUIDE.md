# CollisionIQ — Developer Guide

> ADAS Calibration Documentation & Compliance Management Platform  
> Owner: Cueljuris LLC | Runtime: Node.js | DB: SQLite (node:sqlite built-in)

---

## Table of Contents

1. [What This App Does](#1-what-this-app-does)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Environment Configuration](#4-environment-configuration)
5. [Database Schema](#5-database-schema)
6. [Schema Migration Strategy](#6-schema-migration-strategy)
7. [Startup Sequence](#7-startup-sequence)
8. [Authentication & Session Model](#8-authentication--session-model)
9. [Role System & Access Control](#9-role-system--access-control)
10. [Multi-Tenancy — Shop Scoping](#10-multi-tenancy--shop-scoping)
11. [Job Lifecycle](#11-job-lifecycle)
12. [ADAS Engine](#12-adas-engine)
13. [Grade / Flag System](#13-grade--flag-system)
14. [Photo Documentation System](#14-photo-documentation-system)
15. [QC Checkpoints](#15-qc-checkpoints)
16. [Share Tokens (Read-Only Links)](#16-share-tokens-read-only-links)
17. [Stripe Billing](#17-stripe-billing)
18. [Self-Service Registration Flow](#18-self-service-registration-flow)
19. [Route Map](#19-route-map)
20. [Key Utility Modules](#20-key-utility-modules)
21. [Seeding & Demo Data](#21-seeding--demo-data)
22. [Deployment (Railway)](#22-deployment-railway)
23. [Known Issues & TODOs](#23-known-issues--todos)

---

## 1. What This App Does

CollisionIQ is a multi-tenant SaaS platform for auto collision and ADAS repair shops. Each shop logs repair jobs, documents vehicle damage with structured photos, grades service items (fluids, brakes, sensors, etc.), and generates ADAS calibration requirements automatically from vehicle make/model and repair type.

**The two job tracks:**
- **Post-Collision** — full ADAS evaluation, photo documentation, grading, and QC workflow
- **General Maintenance** — simplified service record (oil, brakes, tires) with grading and VIN flag tracking

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (LTS) |
| Web framework | Express 4 |
| Database | SQLite via `node:sqlite` (built-in, no native binding) |
| Session store | `connect-sqlite3` → `sessions.db` |
| Auth | bcrypt + express-session (cookie, 8h TTL) |
| File uploads | multer → `uploads/` directory |
| Billing | Stripe SDK v21 |
| Config | dotenv |
| PWA | Service worker + Web App Manifest |
| Dev icon gen | sharp (devDependency only) |

No ORM. All queries are raw SQL via `db.prepare(...).run/get/all()`.

---

## 3. Project Structure

```
collisioniq/
├── server.js                  # Entire app — routes, schema init, middleware, helpers
├── adasEngine.js              # ADAS calibration logic (pure function, make/model/repair → flags)
├── package.json
├── .env                       # Config (never commit real keys)
├── collisioniq.db             # Primary SQLite database (DB_PATH)
├── sessions.db                # Session store (separate file)
│
├── db/
│   ├── index.js               # DB singleton (respects DB_PATH env var)
│   └── migrations/
│       ├── 002_stripe_billing.js          # Adds Stripe columns to shops table
│       └── 003_photo_softlock_edit_assign.js  # photo_status, closed_by, job_assignments
│
├── middleware/
│   └── billing.js             # requireActiveSubscription middleware
│
├── routes/
│   ├── billing.js             # Stripe webhook + portal + reactivate routes
│   └── register.js            # Self-service shop signup (Stripe Checkout)
│
├── utils/
│   ├── stripe.js              # Stripe singleton (import this, never call new Stripe elsewhere)
│   ├── photoLabels.js         # Generates structured photo slot list for a job
│   └── photoStatus.js        # Calculates red/yellow/green photo completion status
│
├── scripts/
│   ├── add-yc-admin.js        # One-time script: creates yc_admin platform_admin account
│   └── generate-icons.js      # PWA icon generation (dev only)
│
├── seed-demo.js               # Demo data seeder (shops, users, jobs)
├── public/                    # Static assets (CSS, icons, manifest, sw.js)
└── uploads/                   # Multer upload destination (gitignored)
```

**Important:** `server.js` is a monolith. All route handlers, auth middleware, layout rendering, and helpers live there (~3920 lines). The only things factored out are billing routes, the register route, the ADAS engine, and utility modules.

---

## 4. Environment Configuration

File: `.env`

```env
PORT=3000
SESSION_SECRET=<random string, min 32 chars>
NODE_ENV=production

# Stripe (required for billing to work)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Must match actual deployed URL (used in Stripe redirect URLs)
APP_BASE_URL=https://your-domain.railway.app
```

`DB_PATH` can optionally be set to override the default `collisioniq.db` path. If unset, the database resolves to `./collisioniq.db` relative to project root.

---

## 5. Database Schema

### `shops`
Primary tenant record. One shop = one subscription.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | Shop display name |
| address | TEXT | |
| phone | TEXT | |
| city | TEXT | Added by migration |
| state | TEXT | Added by migration |
| stripe_customer_id | TEXT | Stripe cus_... ID |
| stripe_subscription_id | TEXT | Stripe sub_... ID |
| subscription_status | TEXT | `inactive` / `active` / `past_due` / `grace` / `cancelled` |
| subscription_current_period_end | INTEGER | Unix timestamp |
| grace_period_end | INTEGER | Unix timestamp, 7-day window after failure |
| trial_end | INTEGER | Unix timestamp |
| created_at | TEXT | ISO datetime |

### `users`
All users across all shops. Platform admins have `shop_id = NULL`.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| shop_id | INTEGER | FK → shops.id. NULL for platform_admin |
| username | TEXT UNIQUE | Login credential |
| password_hash | TEXT | bcrypt, saltRounds=10 |
| role | TEXT | See Role System below |
| full_name | TEXT | Display name |
| email | TEXT | Used by self-service registration (same as username for self-signup) |
| active | INTEGER | 1 = active, 0 = deactivated |
| created_at | TEXT | |

### `jobs`
Core repair job record.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Internal auto-increment |
| jobId | TEXT UNIQUE | Human-facing ID, format: `CIQ-YYYYMMDD-XXXX` |
| ro | TEXT | Repair Order number (shop's own reference) |
| vin | TEXT | Vehicle VIN |
| year / make / model / trim | TEXT | Vehicle info (VIN-decoded client-side via NHTSA API) |
| track | TEXT | `post-collision` or `general-maintenance` |
| collision_grade | TEXT | `MINOR` / `MODERATE` / `MAJOR` (post-collision only) |
| mileage | TEXT | Intake mileage |
| return_mileage / return_date | TEXT | Completion mileage/date |
| service_date | TEXT | Date of service |
| technicianName | TEXT | Legacy tech display name field |
| assigned_tech | TEXT | Primary tech full_name |
| repairsPerformed | TEXT | Free-text repairs (drives ADAS engine) |
| adasSystems | TEXT | ADAS engine output — systems requiring calibration |
| rationale | TEXT | ADAS engine output — reasoning |
| liabilityWarning | TEXT | ADAS engine output |
| makeSpecificNotes | TEXT | ADAS engine output |
| preScanRequired / postScanRequired | TEXT | ADAS engine output — scan requirement level |
| approvedScanTool | TEXT | ADAS engine output |
| impact_areas | TEXT | JSON array of zone keys (e.g. `["front_end","roof"]`) |
| status | TEXT | `Created` / `In Progress` / `Calibration Complete` / `Closed` |
| photo_status | TEXT | `red` / `yellow` / `green` — computed by photoStatus.js |
| photo_status_override | INTEGER | 1 = admin manually bypassed photo gate |
| shareToken | TEXT | UUID hex for read-only share link |
| shareUrl | TEXT | `/share/<token>` |
| shop_id | INTEGER | FK → shops.id |
| created_by | INTEGER | FK → users.id |
| closed_by / closed_at | INTEGER / TEXT | Who closed and when |
| last_edited_by / last_edited_at | INTEGER / TEXT | |
| last_changed | TEXT | ISO datetime, updated on every state change |
| createdAt / updatedAt | TEXT | |

### `job_photos`
Structured photo slots. One row = one named photo slot. File may or may not be filled.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| job_id | TEXT | FK → jobs.jobId |
| shop_id | INTEGER | Denormalized for query convenience |
| layer | INTEGER | 1 = overview, 2 = damage detail |
| zone | TEXT | `front_end`, `rear_end`, `driver_side`, `passenger_side`, `roof`, `undercarriage`, `adas_setup` |
| label_key | TEXT | Canonical key (e.g. `OVERVIEW_FRONT`, `DAMAGE_DETAIL_CLOSE`) |
| label_display | TEXT | Human label |
| is_recommended | INTEGER | 1 = optional recommended, 0 = required |
| is_adas | INTEGER | 1 = ADAS-specific photo |
| file_path | TEXT | Relative path under `uploads/`, NULL if not yet uploaded |
| mime_type / file_size_kb | TEXT / INTEGER | |
| tech_name | TEXT | Who uploaded |
| uploaded_at | TEXT | |
| notes | TEXT | |

### `job_service_items`
Graded service items. Multiple rows per job (one per item/measurement).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| job_id | TEXT | |
| item_type | TEXT | e.g. `Oil Change`, `Brake - Front Left`, `Tire Tread` |
| sub_item | TEXT | Specific sub-component |
| grade | TEXT | `GREEN` / `YELLOW` / `RED` |
| measurement | TEXT | e.g. oil viscosity, brake mm reading |
| note | TEXT | Technician note |
| tech_name | TEXT | |
| updated_at | TEXT | |

### `grade_audit`
Immutable log of every grade assignment. Never updated, only inserted.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| job_id | TEXT | |
| shop_id | INTEGER | |
| tech_name | TEXT | |
| item_type | TEXT | |
| sub_item | TEXT | |
| grade | TEXT | |
| previous_grade | TEXT | NULL on first grade |
| timestamp | TEXT | |
| note | TEXT | |

### `vin_flags`
Persistent VIN-level issues that carry across jobs. A YELLOW flag on VIN X in job A is visible when creating job B for the same VIN.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| shop_id | INTEGER | |
| vin | TEXT | |
| item_type | TEXT | |
| sub_item | TEXT | |
| grade | TEXT | `YELLOW` or `RED` |
| origin_job_id | TEXT | Job that created the flag |
| date_flagged | TEXT | |
| status | TEXT | `OPEN` / `ESCALATED` / `RESOLVED` |
| resolved_job_id | TEXT | Job that resolved it (GREEN grade) |
| date_resolved | TEXT | |

**Flag state machine:**
- YELLOW grade → new OPEN flag
- RED grade on OPEN YELLOW flag → flag becomes ESCALATED + new RED flag inserted
- GREEN grade → most recent OPEN/ESCALATED flag becomes RESOLVED

### `job_checkpoints`
8-step QC workflow, auto-created for MODERATE collision jobs.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| job_id | TEXT | |
| checkpoint_index | INTEGER | 0–7 |
| label | TEXT | Step description |
| completed | INTEGER | 0 / 1 |
| completed_by | TEXT | |
| completed_at | TEXT | |

### `share_tokens`
Read-only external access tokens.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| job_id | TEXT | |
| token | TEXT UNIQUE | 32-char hex |
| created_at | TEXT | |
| expires_at | TEXT | NULL = never |
| revoked | INTEGER | 0 / 1 |

### `job_assignments`
Many-to-many: which users are assigned to which jobs.

| Column | Type | Notes |
|---|---|---|
| job_id | TEXT | PK (composite with user_id) |
| user_id | INTEGER | FK → users.id |
| assigned_by | INTEGER | FK → users.id |
| assigned_at | TEXT | |

### `photos`
Legacy photo table from before the structured slot system. Still exists but `job_photos` is the active table.

---

## 6. Schema Migration Strategy

There is no migration runner or version table. Instead:

- Initial schema (`CREATE TABLE IF NOT EXISTS`) runs inline at server startup in `server.js`
- Column additions use `ALTER TABLE ... ADD COLUMN` wrapped in `try/catch` — SQLite throws if the column already exists, so this is safe to run on every boot
- Dedicated migration files in `db/migrations/` export a `runMigration(db)` function and are called once at startup after base schema init
- This means the app is always safe to start fresh or restart against an existing database

**Order in server.js startup:**
1. `CREATE TABLE IF NOT EXISTS` for jobs, vin_flags, grade_audit, job_service_items, photos, job_checkpoints, share_tokens
2. `ALTER TABLE jobs ADD COLUMN` migrations for legacy columns
3. `CREATE TABLE IF NOT EXISTS` for shops, users
4. `ALTER TABLE jobs ADD COLUMN` for shop_id, created_by
5. `CREATE TABLE IF NOT EXISTS` for job_photos (with indexes)
6. `require('./db/migrations/002_stripe_billing').runMigration(db)` — Stripe columns on shops
7. `require('./db/migrations/003_photo_softlock_edit_assign').runMigration(db)` — photo_status, job_assignments
8. `ALTER TABLE shops ADD COLUMN city/state`
9. `ALTER TABLE users ADD COLUMN email`

---

## 7. Startup Sequence

```
node server.js
  ├── dotenv.config()
  ├── require('./db')            → opens collisioniq.db (creates if not exists)
  ├── Schema init (steps 1–9 above)
  ├── Express middleware stack built
  │   ├── /api/billing/webhook  (raw body — MUST be before express.json())
  │   ├── express.urlencoded + express.json
  │   ├── /sw.js (no-cache headers)
  │   ├── express.static public/
  │   ├── express-session (SQLiteStore → sessions.db)
  │   ├── routes/register.js
  │   └── routes/billing.js
  ├── Upload dir ensured
  ├── All inline routes registered
  └── seedPlatformAdmin()
      ├── Checks if any platform_admin exists
      ├── If not: bcrypt.hash('changeme123') + INSERT
      └── app.listen(PORT)
```

The server does not crash if Stripe keys are missing or invalid — billing routes will fail at runtime on actual API calls, but startup completes.

---

## 8. Authentication & Session Model

**Login flow:**
1. `POST /login` — looks up `users WHERE username=? AND active=1`
2. `bcrypt.compare(password, user.password_hash)`
3. On success: writes to `req.session.user`:
   ```js
   { id, username, full_name, role, shop_id }
   ```
4. Session persisted to `sessions.db` via `connect-sqlite3`
5. Cookie TTL: 8 hours

**Session shop:** `req.session.shop` is only populated during self-service registration (written in `routes/register.js` after Stripe checkout). It is NOT set on normal login. Shop data is instead loaded per-request via `req.shopId` (set by `shopScope` middleware) and queried inline in each route.

**Logout:** `GET /logout` → `req.session.destroy()` → redirect `/login`

---

## 9. Role System & Access Control

Five roles. All enforced by middleware on every route.

| Role | Description |
|---|---|
| `platform_admin` | Master access. Sees all shops. `shop_id = NULL`. Has shop switcher UI. |
| `shop_admin` | Full access within their shop. Can manage users. |
| `qc_manager` | Read access + grading + checkpoints. Cannot create jobs. |
| `service_writer` | Can create and edit jobs. Cannot grade. |
| `technician` | Sees only their own assigned jobs. Can grade. |

**Middleware functions (all in server.js):**

| Function | Guards |
|---|---|
| `requireAuth` | Any logged-in user |
| `requireAdmin` | `shop_admin` or `platform_admin` |
| `requireCreate` | `platform_admin`, `shop_admin`, `service_writer` |
| `requireEdit` | `platform_admin`, `shop_admin`, `service_writer` |
| `requireQC` | `platform_admin`, `shop_admin`, `qc_manager` |
| `requirePlatformAdmin` | `platform_admin` only |
| `shopScope` | Sets `req.shopId` — not a gate, see below |

**Nav links rendered by `layout()` are role-filtered** — each role gets a different nav subset hardcoded in the `layout()` function.

---

## 10. Multi-Tenancy — Shop Scoping

The `shopScope` middleware sets `req.shopId`:

```js
function shopScope(req, res, next) {
  if (req.session.user.role === 'platform_admin') {
    req.shopId = req.session.shopFilter || null;  // voluntary filter, never hard-restricted
  } else {
    req.shopId = req.session.user.shop_id;        // always scoped to own shop
  }
  next();
}
```

Every data query then uses `req.shopId` as a WHERE clause. If `req.shopId` is null (platform_admin in "all shops" view), queries omit the shop filter and return all records.

**Platform admin shop switcher:** A `<select>` in the nav POSTs to `POST /platform/shop-filter` which sets `req.session.shopFilter`. This persists across requests for the session duration.

---

## 11. Job Lifecycle

### Job ID
Format: `CIQ-YYYYMMDD-XXXX` (e.g. `CIQ-20260407-3821`). Generated by `generateJobId()` at insert time. Stored in `jobs.jobId` (TEXT UNIQUE). The auto-increment `id` column is internal only.

### Two tracks

**Post-Collision** (`POST /jobs` with `track=post-collision`):
1. Form collects: VIN, vehicle info, collision grade (MINOR/MODERATE/MAJOR), impact zones, repairs performed, photos
2. `runADASEngine(make, model, year, repairs)` runs immediately → ADAS output stored on the job
3. Photo slots generated via `generatePhotoLabels(job)` → inserted into `job_photos`
4. If `collision_grade = MODERATE`: 8 QC checkpoints auto-inserted into `job_checkpoints`
5. Job status starts at `Created`

**General Maintenance** (`POST /jobs` with `track=general-maintenance`):
1. Form collects: VIN, vehicle info, service items (oil, brakes, tires, battery, wiper, air filter, coolant)
2. Each checked service item → `applyGradeFlag()` called
3. No ADAS engine, no photo slots, no QC checkpoints
4. Job status starts at `Created`

### Status progression
```
Created → In Progress → Calibration Complete → Closed
```
Status changes are manual (set by shop_admin, service_writer, or platform_admin via edit form).

### Job close
`POST /jobs/:id/close` — `requireEdit` required. Sets status to `Closed`, records `closed_by` (user ID) and `closed_at` (ISO timestamp). Only platform_admin/shop_admin can reopen.

---

## 12. ADAS Engine

**File:** `adasEngine.js`  
**Entry point:** `runADASEngine(make, model, year, repairs)`  
**Returns:** object with `{ adasSystems, rationale, liabilityWarning, makeSpecificNotes, preScanRequired, postScanRequired, approvedScanTool, sourceCitation }`

The engine is a pure function — no DB access, no I/O. It evaluates repair strings (lowercased) against a hardcoded OEM rule set organized by make group.

**Supported make groups:**
- Toyota / Lexus / Scion
- Honda / Acura
- Ford / Lincoln
- GM (Chevrolet, GMC, Buick, Cadillac)
- Stellantis (Chrysler, Dodge, Jeep, Ram, Fiat)
- Nissan / Infiniti
- Hyundai / Kia / Genesis
- Subaru
- Mazda
- Volkswagen / Audi / Porsche / SEAT / Skoda
- Volvo
- BMW / MINI
- Mercedes-Benz / Sprinter
- Tesla

**Repair keywords that trigger flags:** windshield, front camera, front bumper, radar, rear bumper, door, mirror, airbag/SRS, structural body repair, roof, quarter panel, A/B/C-pillar, headliner, alignment, wheel, etc.

Data sourced from OEM position statements (Toyota CRIB 191, Honda ASN-36-0001, Ford WSB-M1-212, etc.) — cited in the rationale output.

VIN decode (year/make/model/trim auto-fill) happens **client-side** via the NHTSA public API (`vpic.nhtsa.dot.gov`) — no server involvement.

---

## 13. Grade / Flag System

**Function:** `applyGradeFlag(vin, shopId, jobId, techName, itemType, subItem, grade, prevGrade, measurement, note)`

Called when a technician submits grades in the tech view form. Does three things atomically (no transaction, but SQLite is serialized):

1. **INSERT into `job_service_items`** — records the grade + measurement for this job
2. **INSERT into `grade_audit`** — immutable log entry
3. **Flag logic on `vin_flags`:**
   - GREEN → finds OPEN/ESCALATED flag for same VIN+itemType → marks RESOLVED
   - YELLOW → inserts new OPEN flag
   - RED → if existing OPEN YELLOW flag exists → escalates it; inserts new RED flag

**Grade buttons** render as a radio-style three-button row (GREEN/YELLOW/RED) with a hidden `<input>` that stores the current value. Submitted as part of the tech view form POST.

**VIN Flag Dashboard** (`GET /dashboard/flags`) — available to `platform_admin`, `shop_admin`, `qc_manager`. Shows all OPEN and ESCALATED flags for the shop, grouped by VIN.

---

## 14. Photo Documentation System

Two-layer system. All photo slots are pre-generated at job creation time (rows in `job_photos` with `file_path = NULL`). Upload fills in the `file_path`.

**Layer 1 — Overview (always present):**
- 4 fixed shots: Front, Rear, Driver Side, Passenger Side
- 1 "full context" shot per impact zone selected at job creation

**Layer 2 — Damage Detail (per impact zone):**
- 7 shots per zone: close detail, wide detail, adjacent panel left/right, undamaged mirror side (recommended), in-process repair, finished state
- ADAS setup shots (3) added if `job.adas_required` (i.e. ADAS engine flagged calibrations)

**Photo status** (`utils/photoStatus.js`):
- `red` — one or more Layer 1 required photos missing
- `yellow` — all Layer 1 complete, Layer 2 incomplete
- `green` — all required photos in both layers uploaded

Status is recalculated and persisted to `jobs.photo_status` on every upload or delete via `updateJobPhotoStatus(db, jobId)`.

**Layer 1 softlock:** Layer 2 uploads are blocked in the UI (but not server-side) until Layer 1 is complete. `photo_status_override` (set by platform_admin/shop_admin) bypasses this.

**Upload endpoint:** `POST /api/jobs/:jobId/photos/:photoId` — multer handles multipart. File saved to `uploads/`. Row in `job_photos` updated with `file_path`, `mime_type`, `file_size_kb`, `tech_name`.

**Delete endpoint:** `DELETE /api/jobs/:jobId/photos/:photoId/file` — removes file from disk, clears `file_path` in DB, recalculates photo status.

---

## 15. QC Checkpoints

Auto-generated for post-collision jobs with `collision_grade = MODERATE`.

**8 checkpoint labels:**
1. Pre-repair scan complete — DTCs documented
2. Structural repair complete — frame inspection signed off
3. Panel replacement complete — ADAS sensor mounting points inspected
4. ADAS calibration setup — targets placed, tool connected
5. Calibration performed — readings documented
6. Post-repair scan complete — no ADAS-related DTCs remaining
7. Road test / dynamic verification complete
8. QC Manager final sign-off

**Marking complete:** `POST /jobs/:id/checkpoints/:index/complete` — `requireQC`. Records `completed_by` (user's full_name) and `completed_at`.

Checkpoints are displayed as a progress-style checklist in the job detail view.

---

## 16. Share Tokens (Read-Only Links)

Every job gets a `shareToken` (32-char hex, generated at job creation via `crypto.randomBytes(16).toString('hex')`). The share URL is `/share/<token>`.

`GET /share/:token` — **no auth required**. Renders a read-only view of the job including all photos, ADAS findings, and grade summary. Suitable for insurers, customers, or auditors.

Share tokens are stored in both `jobs.shareToken`/`jobs.shareUrl` and the `share_tokens` table. The `share_tokens` table supports expiry and revocation fields (not yet wired to UI — infrastructure is in place).

---

## 17. Stripe Billing

### Architecture

```
utils/stripe.js          → Stripe singleton (new Stripe(STRIPE_SECRET_KEY))
routes/billing.js        → webhook handler + portal + reactivate
middleware/billing.js    → requireActiveSubscription gate
routes/register.js       → self-service Stripe Checkout flow
```

### Subscription status values (stored on shops.subscription_status)

| Value | Meaning |
|---|---|
| `inactive` | Never subscribed (new shop onboarded manually by platform_admin) |
| `active` | Paid and current |
| `past_due` | Payment failed, in 7-day grace |
| `grace` | Subscription cancelled, in 7-day grace |
| `cancelled` | Grace expired, full lockout |
| `trial` | Trial period (infrastructure exists, not wired to Stripe trial) |

### Webhook events handled (`POST /api/billing/webhook`)

| Event | Action |
|---|---|
| `checkout.session.completed` | Set subscription active + store sub ID |
| `invoice.payment_succeeded` | Extend period end, clear grace |
| `invoice.payment_failed` | Set past_due, set grace_period_end = now + 7 days |
| `customer.subscription.updated` | Update status + period end |
| `customer.subscription.deleted` | Set grace, grace_period_end = now + 7 days |

**Critical:** The webhook route must be registered **before** `express.json()`. It requires `express.raw({ type: 'application/json' })` for Stripe signature verification. This order is correct in server.js.

### `requireActiveSubscription` middleware

- `platform_admin` bypasses entirely
- `active` → pass through
- `past_due` / `grace` → pass through but sets `req.session.billingRestricted = true` (UI can check this to disable new job creation)
- Grace period expired → force status to `cancelled`, redirect `/billing/cancelled`
- `inactive` → redirect `/register`
- `cancelled` → redirect `/billing/cancelled`

### Billing portal (`GET /billing/portal`)

Uses Stripe Billing Portal. Requires `shop.stripe_customer_id`. Available to `shop_admin` and `platform_admin`.

---

## 18. Self-Service Registration Flow

`routes/register.js`

```
GET  /register          → show form
POST /register          → validate → create Stripe customer → create Checkout session
                           → store pending data in req.session.pending_registration
                           → redirect to Stripe-hosted Checkout page
GET  /register/success  → Stripe redirects here with ?session_id=...
                           → verify payment_status === 'paid'
                           → INSERT shop + INSERT shop_admin user
                           → set req.session.user + req.session.shop
                           → redirect /
GET  /register?cancelled=1  → show form with "payment cancelled" message
```

**Session data during registration:** `req.session.pending_registration` holds `{ shop_name, owner_name, email, password_hash, city, state, stripe_customer_id }` between the Checkout redirect and the success callback.

**User created:** `shop_admin` role. `username` = email address. `email` column also populated.

---

## 19. Route Map

### Public (no auth)
| Method | Path | Description |
|---|---|---|
| GET | `/login` | Login page |
| POST | `/login` | Authenticate |
| GET | `/logout` | Destroy session |
| GET | `/register` | Self-service signup form |
| POST | `/register` | Start Stripe Checkout |
| GET | `/register/success` | Post-payment account creation |
| GET | `/share/:token` | Read-only job share view |
| POST | `/api/billing/webhook` | Stripe webhook |
| GET | `/billing/cancelled` | Subscription inactive page |

### Authenticated — any role
| Method | Path | Description |
|---|---|---|
| GET | `/` | Job list |
| GET | `/jobs/:id` | Job detail |
| GET | `/reference` | ADAS reference library |
| GET | `/reference/:make` | Make-specific ADAS reference |

### Create/Edit — platform_admin, shop_admin, service_writer
| Method | Path | Description |
|---|---|---|
| GET | `/new` | New job form |
| POST | `/jobs` | Create job |
| GET | `/jobs/:id/edit` | Edit job form |
| POST | `/jobs/:id/edit` | Save job edits |
| POST | `/jobs/:id/close` | Close job |
| POST | `/jobs/:id/assign` | Update team assignments |

### QC — platform_admin, shop_admin, qc_manager
| Method | Path | Description |
|---|---|---|
| GET | `/dashboard/flags` | VIN flag dashboard |
| POST | `/jobs/:id/checkpoints/:index/complete` | Mark checkpoint done |
| GET | `/jobs/:id/tech` | Tech grading view |
| POST | `/jobs/:id/tech` | Submit grades |

### Admin — platform_admin, shop_admin
| Method | Path | Description |
|---|---|---|
| GET | `/admin` | Shop admin panel |
| GET | `/admin/users` | User management |
| POST | `/admin/users/create` | Create shop user |
| POST | `/admin/users/:id/role` | Change user role |
| POST | `/admin/users/:id/deactivate` | Deactivate user |

### Platform Admin only
| Method | Path | Description |
|---|---|---|
| GET | `/platform/shops` | All shops list |
| POST | `/platform/shops/create` | Onboard new shop manually |
| GET | `/platform/billing` | Billing overview dashboard |
| POST | `/platform/shop-filter` | Set shop switcher |
| GET | `/platform/demo-credentials` | Demo account list |
| POST | `/platform/reset-demo-jobs` | Wipe + reseed demo jobs |
| GET/POST | `/billing/portal` | Stripe billing portal |
| POST | `/billing/reactivate` | Restart subscription |

### Photo API
| Method | Path | Description |
|---|---|---|
| POST | `/api/jobs/:jobId/photos/:photoId` | Upload photo to slot |
| DELETE | `/api/jobs/:jobId/photos/:photoId/file` | Remove photo from slot |

---

## 20. Key Utility Modules

### `utils/stripe.js`
Exports a single Stripe instance. Logs all STRIPE-prefixed env var names at startup (diagnostic). Import this everywhere — never call `new Stripe()` elsewhere.

### `utils/photoLabels.js`
`generatePhotoLabels(job)` — takes a job object with `impact_areas` (array of zone keys) and `adas_required` flag. Returns array of label objects ready to insert into `job_photos`.

### `utils/photoStatus.js`
- `calculatePhotoStatus(jobPhotoRows)` — pure function, returns `'red'`/`'yellow'`/`'green'`
- `updateJobPhotoStatus(db, jobId)` — queries `job_photos`, calculates, persists to `jobs.photo_status`

### `adasEngine.js`
Pure function. No side effects. Test it by calling directly with make/model/year/repairs. All OEM source citations are hardcoded in rationale strings.

### `db/index.js`
Opens `collisioniq.db` (or `DB_PATH` env var). Creates parent directory if needed. Exports the `DatabaseSync` instance. Import as `const db = require('./db')`.

---

## 21. Seeding & Demo Data

### `seed-demo.js`
Run directly: `node seed-demo.js`

Creates:
- 5 demo shops (Metro, Northside, Southbelt, Premier, Gulf Coast)
- ~19 demo users across roles (all with password `demo1234`)
- 11 demo jobs spread across shops

Safe to run multiple times — skips existing records by username/shop name check.

### `seedPlatformAdmin()` (in server.js)
Runs at startup. Creates `platform_admin` user (password: `changeme123`) only if no `platform_admin` exists. Safe to restart.

### `scripts/add-yc-admin.js`
One-time script for investor demo access. Creates `yc_admin` (platform_admin, password: `CollisionIQ2026!`). Checks for existence before inserting — safe to run again.

### `POST /platform/reset-demo-jobs`
Platform admin UI button that wipes all demo jobs and reseeds them. Does NOT touch users or shops.

---

## 22. Deployment (Railway)

**`railway.toml`** and **`Procfile`** are both present. Railway uses `npm start` → `node --disable-warning=ExperimentalWarning server.js`.

**Required Railway environment variables:**
```
PORT                    (Railway sets this automatically)
SESSION_SECRET          (generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
NODE_ENV                production
STRIPE_SECRET_KEY       sk_live_...
STRIPE_PRICE_ID         price_...
STRIPE_WEBHOOK_SECRET   whsec_...
APP_BASE_URL            https://<your-railway-domain>
DB_PATH                 (optional — defaults to ./collisioniq.db)
```

**Persistence:** Railway volumes must be configured for `collisioniq.db`, `sessions.db`, and `uploads/` to survive redeploys. Without a volume, all data is lost on each deploy.

**Stripe webhook registration:** Register `https://<domain>/api/billing/webhook` in Stripe Dashboard → Developers → Webhooks. Subscribe to: `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.

---

## 23. Known Issues & TODOs

**Stripe not functional** — All three Stripe env vars are set to placeholder values (`REPLACE_ME`). No billing functionality works until real keys are populated.

**`APP_BASE_URL` points to localhost** — Must be updated to production domain before any Stripe Checkout redirects will work.

**No DB transaction wrappers** — `applyGradeFlag` does 3 sequential writes with no `BEGIN TRANSACTION`. Unlikely to matter with SQLite's serialized writes, but worth addressing if concurrent write load increases.

**Schema defined inline in server.js** — The base schema (jobs, users, shops, photos, etc.) is not in a migration file; it's `CREATE TABLE IF NOT EXISTS` at the top of server.js. Future schema changes should go into numbered migration files in `db/migrations/`.

**`photos` table (legacy)** — Exists in schema, not used by current photo upload code. `job_photos` is the active table. The old `photos` table can be dropped once confirmed no references remain.

**`share_tokens` table** — `expires_at` and `revoked` columns exist but are not enforced anywhere. Token is only checked against `jobs.shareToken` directly.

**`req.session.shop` not set on login** — The `requireActiveSubscription` middleware reads `req.session.shop` but this is only populated during self-service registration. Shops onboarded manually via `POST /platform/shops/create` never have this set. The middleware short-circuits for `platform_admin` but this would be a bug for any manually-onboarded shop_admin trying to access a route gated by `requireActiveSubscription`.

**No CSRF protection** — All state-changing POST routes rely on session cookies with no CSRF token. Low risk for a closed B2B app but worth adding if exposure grows.

**No rate limiting on `/login`** — Brute force is possible. Consider adding `express-rate-limit` on the login POST route.

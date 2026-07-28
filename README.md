# 🔒 Digital Evidence Vault

A production-quality RESTful API for law enforcement agencies to securely manage digital evidence with full chain of custody tracking. Built as a university backend course project demonstrating real-world patterns.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [Role-Based Access Control](#role-based-access-control)
- [Security Features](#security-features)
- [Testing](#testing)
- [Architecture Decisions](#architecture-decisions)

---

## Overview

The Digital Evidence Vault manages the complete lifecycle of digital evidence:

1. **Upload** — investigators upload files; SHA-256 hash is computed for integrity
2. **Review** — supervisors approve or reject pending evidence
3. **Track** — every action is logged for legal chain of custody
4. **Download** — integrity is re-verified on every download
5. **Report** — PDF reports, QR codes, CSV audit exports

### Key Capabilities

| Feature | Description |
|---------|-------------|
| JWT Authentication | Access + refresh token rotation with blacklisting |
| Role-Based Access | ADMIN / SUPERVISOR / INVESTIGATOR with granular permissions |
| Evidence Integrity | SHA-256 hash computed on upload, verified on every download |
| AES-256 Encryption | Optional file encryption at rest |
| Chain of Custody | Immutable audit log for every action |
| QR Code Verification | Scannable QR codes for physical evidence tags |
| PDF Reports | Case summary and chain-of-custody reports |
| Notifications | In-app alerts for key events |
| Dashboard | Role-scoped statistics and chart data |

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | ≥ 18.0.0 |
| Framework | Express.js | 5.x |
| ORM | Prisma | 7.x |
| Database | PostgreSQL | 15+ |
| Auth | JSON Web Tokens | 9.x |
| Password | bcryptjs | 3.x |
| Validation | Zod | 4.x |
| File Upload | Multer | 2.x |
| Logging | Winston | 3.x |
| PDF | PDFKit | 0.19.x |
| QR Codes | qrcode | 1.5.x |
| Email | Nodemailer | 9.x |
| Testing | Jest + Supertest | 30.x / 7.x |
| Docs | Swagger UI | 5.x |

---

## Project Structure

```
digital-evidence-vault/
├── prisma/
│   ├── schema.prisma          # Database schema (6 tables)
│   └── seed.js                # Development seed data
├── src/
│   ├── app.js                 # Express app config
│   ├── server.js              # HTTP server entry point
│   ├── config/
│   │   ├── index.js           # Centralised configuration
│   │   ├── database.js        # Prisma client (singleton)
│   │   └── swagger.js         # OpenAPI spec config
│   ├── middleware/
│   │   ├── auth.middleware.js  # JWT verify + RBAC
│   │   ├── error.middleware.js # Global error handler
│   │   ├── logging.middleware.js
│   │   └── upload.middleware.js # Multer + file type filter
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── case.routes.js
│   │   ├── evidence.routes.js
│   │   ├── audit.routes.js
│   │   ├── notification.routes.js
│   │   └── dashboard.routes.js
│   ├── controllers/           # Thin HTTP layer
│   ├── services/              # Business logic
│   ├── validators/            # Zod schemas
│   └── utils/
│       ├── file.util.js       # SHA-256, file ops
│       ├── encryption.util.js # AES-256-GCM
│       ├── qrcode.util.js     # QR generation
│       ├── pdf.util.js        # PDF reports
│       ├── email.util.js      # Nodemailer
│       ├── jwt.util.js
│       ├── password.util.js
│       └── logger.js
├── tests/
│   ├── fixtures/
│   │   └── test-evidence.txt
│   ├── app.test.js
│   ├── auth.test.js
│   ├── user.test.js
│   ├── case.test.js
│   ├── evidence.test.js
│   ├── audit.test.js
│   ├── dashboard.test.js
│   ├── notification.test.js
│   └── setup.js
├── logs/
├── uploads/                   # Evidence file storage
├── .env.example
└── README.md
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 18.0.0
- PostgreSQL 15+
- Docker (recommended for local database)

### 1. Clone & Install

```bash
git clone <repo-url>
cd digital-evidence-vault
npm install
```

### 2. Start the Database

```bash
docker run --name evidence-vault-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=evidence_vault \
  -p 5432:5432 -d postgres:15
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 4. Set Up the Database

```bash
npx prisma db push      # Apply schema
npm run prisma:seed     # Create test users
```

### 5. Start the Server

```bash
npm run dev             # Development (nodemon)
npm start               # Production
```

The API will be running at `http://localhost:3000`.  
Swagger docs: `http://localhost:3000/api-docs`

---

## Environment Variables

```env
# Server
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/evidence_vault"

# JWT (change in production!)
JWT_ACCESS_SECRET=your-32-char-secret
JWT_REFRESH_SECRET=your-32-char-refresh-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Password Hashing
BCRYPT_SALT_ROUNDS=12

# File Encryption (must be exactly 32 characters)
ENCRYPTION_KEY=your-32-character-encryption-key!

# File Upload
MAX_FILE_SIZE=104857600   # 100 MB
UPLOAD_PATH=./uploads

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# CORS
CORS_ORIGIN=*

# Email (optional)
EMAIL_HOST=smtp.mailtrap.io
EMAIL_PORT=587
EMAIL_USER=
EMAIL_PASS=
EMAIL_FROM=noreply@evidence-vault.com
```

---

## API Endpoints

### Authentication — `/api/v1/auth`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/login` | Login, returns JWT pair | Public |
| POST | `/register` | Create account (admin only) | Admin |
| POST | `/refresh` | Rotate access token | Public |
| POST | `/logout` | Revoke refresh token | Any |
| GET | `/me` | Get own profile | Any |
| PUT | `/change-password` | Change own password | Any |

### Users — `/api/v1/users`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/` | List users (paginated) | Admin, Supervisor |
| GET | `/me` | Own profile | Any |
| GET | `/statistics` | User counts by role | Admin |
| GET | `/:id` | Get user | Admin or Self |
| POST | `/` | Create user | Admin |
| PUT | `/me` | Update own profile | Any |
| PUT | `/:id` | Update user | Admin or Self |
| DELETE | `/:id` | Soft delete | Admin |
| POST | `/:id/restore` | Restore deleted user | Admin |
| POST | `/:id/reset-password` | Admin resets password | Admin |

### Cases — `/api/v1/cases`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/` | List cases (role-scoped) | Any |
| GET | `/statistics` | Case counts | Any |
| GET | `/number/:caseNumber` | Lookup by number | Any |
| GET | `/:id` | Case details | Role-scoped |
| POST | `/` | Create case | Admin, Supervisor |
| PUT | `/:id` | Update case | Admin, Supervisor, Investigator (limited) |
| PUT | `/:id/assign` | Assign investigator | Admin, Supervisor |
| POST | `/:id/close` | Close case | Admin, Supervisor |
| POST | `/:id/reopen` | Reopen case | Admin, Supervisor |
| DELETE | `/:id` | Soft delete | Admin |

### Evidence — `/api/v1/evidence`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/` | List evidence (role-scoped) | Any |
| GET | `/statistics` | Evidence stats | Any |
| POST | `/upload` | Upload file (multipart) | Any |
| GET | `/:id` | Evidence metadata | Role-scoped |
| GET | `/:id/download` | Stream file (integrity check) | Role-scoped |
| GET | `/:id/verify` | On-demand integrity check | Role-scoped |
| GET | `/:id/qrcode` | Generate QR code | Any |
| PUT | `/:id/approve` | Approve evidence | Admin, Supervisor |
| PUT | `/:id/reject` | Reject with reason | Admin, Supervisor |
| DELETE | `/:id` | Soft delete | Admin |

### Audit Logs — `/api/v1/audit`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/` | Paginated audit logs | Admin, Supervisor |
| GET | `/statistics` | Log counts | Admin, Supervisor |
| GET | `/export` | Download as CSV | Admin, Supervisor |
| GET | `/evidence/:id` | Chain of custody | Admin, Supervisor |
| GET | `/case/:id` | Full case trail | Admin, Supervisor |
| GET | `/user/:id` | User activity | Admin, Supervisor |

### Notifications — `/api/v1/notifications`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/` | Own notifications | Any |
| GET | `/unread-count` | Badge count | Any |
| PUT | `/read-all` | Mark all as read | Any |
| DELETE | `/clear-read` | Delete read notifications | Any |
| PUT | `/:id/read` | Mark one as read | Any |
| DELETE | `/:id` | Delete one | Any |

### Dashboard — `/api/v1/dashboard`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/stats` | Full snapshot | Any |
| GET | `/recent-uploads` | Latest evidence | Any |
| GET | `/monthly-uploads` | Chart data (N months) | Any |
| GET | `/activity` | Live activity feed | Any |

---

## Role-Based Access Control

```
ADMIN
  └─ Full system access
  └─ Create/delete users
  └─ Delete cases and evidence
  └─ Access all audit logs

SUPERVISOR
  └─ Create and manage cases
  └─ Approve / reject evidence
  └─ Assign investigators
  └─ View audit logs
  └─ Generate PDF reports

INVESTIGATOR
  └─ View assigned cases only
  └─ Upload evidence to assigned case
  └─ View / download own evidence
  └─ View own notifications and activity
```

### Seed Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@evidence-vault.com | Admin@123456 |
| Supervisor | supervisor@evidence-vault.com | Super@123456 |
| Investigator 1 | investigator1@evidence-vault.com | Invest@123456 |
| Investigator 2 | investigator2@evidence-vault.com | Invest@123456 |

---

## Security Features

### Authentication & Authorization
- **JWT access tokens** (15 min expiry) + **refresh tokens** (7 days)
- `jti` claim prevents token replay attacks
- Refresh tokens stored in DB and revoked on logout / password change
- Token family rotation — old token revoked when refreshed

### Evidence Integrity
- **SHA-256 hash** computed on every upload
- Hash re-verified on **every download** — tampered files rejected with HTTP 422
- On-demand `/verify` endpoint for manual integrity checks
- All integrity checks logged to audit trail

### File Security
- **AES-256-GCM** encryption at rest (optional per upload)
- UUID-based filenames — no path traversal, no enumeration
- MIME type whitelist enforced by Multer
- File size limit (100 MB default, configurable)

### API Security
- Helmet.js sets 11 security headers
- CORS restricted to configured origins
- Rate limiting (100 req/15min globally, 10 req/15min on auth routes)
- All inputs validated with Zod before reaching services

### Audit Trail
- Every significant action logged with WHO, WHAT, WHEN, WHERE
- Logs are **immutable** — no delete or update endpoints
- CSV export for legal proceedings

---

## Testing

```bash
npm test                    # Run all tests with coverage
npm test -- tests/auth.test.js   # Single suite
```

### Test Results

| Suite | Tests | Coverage |
|-------|-------|----------|
| app.test.js | 7 | Health, CORS, security headers |
| auth.test.js | 22 | Login, register, tokens, passwords |
| user.test.js | 42 | CRUD, RBAC, soft delete |
| case.test.js | 41 | Case lifecycle, assignments |
| evidence.test.js | 30 | Upload, download, integrity, approval |
| audit.test.js | 30 | Chain of custody, CSV export |
| dashboard.test.js | 22 | Stats, charts, activity |
| notification.test.js | 18 | CRUD, triggers |
| **Total** | **212** | **~75%** |

---

## Architecture Decisions

### Layered Architecture
```
HTTP Request
    ↓
Router (route matching)
    ↓
Middleware (auth, validation, upload)
    ↓
Controller (extract request data, call service, format response)
    ↓
Service (business logic, DB calls, audit logging)
    ↓
Prisma ORM → PostgreSQL
```

### Why Soft Deletes?
Evidence and cases are never hard-deleted. Setting `deletedAt` preserves:
- Referential integrity (evidence references cases)
- Audit trail (you can see when something was "deleted")
- Legal recoverability

### Why SHA-256 on Every Download?
Re-computing the hash at download time (not just storing it) catches:
- File system corruption
- Direct database/disk tampering
- Man-in-the-middle storage attacks

### Why BigInt for File Sizes?
JavaScript's `Number.MAX_SAFE_INTEGER` is ~9 petabytes, but databases use 64-bit integers. Using `BigInt` in Node.js and serialising to string prevents silent precision loss for large files.

### Why Parallel Queries?
`Promise.all()` in the dashboard runs 8–10 independent DB queries simultaneously. With connection pooling (Prisma default: 10 connections), this turns a 400 ms sequential scan into a ~50 ms parallel one.

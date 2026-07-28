# Digital Evidence Vault - Database Design

## Overview

This document describes the database schema for the Digital Evidence Vault system. The database is designed to support secure evidence management with complete chain of custody tracking.

## Entity Relationship Diagram

```
┌────────────────────┐
│       User         │
├────────────────────┤
│ id (PK)            │
│ email (UNIQUE)     │
│ name               │
│ password_hash      │
│ role (ENUM)        │
│ refresh_token      │
│ created_at         │
│ updated_at         │
│ last_login_at      │
│ deleted_at         │
└────────────────────┘
         │
         │ 1:N (creates)
         ▼
┌────────────────────┐
│       Case         │
├────────────────────┤
│ id (PK)            │
│ case_number (UQ)   │
│ title              │
│ description        │
│ status (ENUM)      │
│ priority           │
│ created_by_id (FK) │◄──── User creates cases
│ assigned_inv_id(FK)│◄──── User assigned to case
│ created_at         │
│ updated_at         │
│ closed_at          │
│ deleted_at         │
└────────────────────┘
         │
         │ 1:N (contains)
         ▼
┌────────────────────┐
│     Evidence       │
├────────────────────┤
│ id (PK)            │
│ file_name          │
│ original_name      │
│ file_type          │
│ file_size          │
│ storage_path       │
│ sha256_hash        │◄──── Integrity verification
│ encryption_iv      │
│ is_encrypted       │
│ status (ENUM)      │
│ reject_reason      │
│ description        │
│ case_id (FK)       │◄──── Belongs to case
│ uploaded_by_id(FK) │◄──── User uploads
│ reviewed_by_id(FK) │◄──── User reviews
│ reviewed_at        │
│ uploaded_at        │
│ updated_at         │
│ deleted_at         │
│ deleted_by_id      │
└────────────────────┘

┌────────────────────┐
│    AuditLog        │
├────────────────────┤
│ id (PK)            │
│ user_id (FK)       │◄──── Who did it
│ action (ENUM)      │◄──── What they did
│ entity (ENUM)      │◄──── What type
│ entity_id          │◄──── Which record
│ ip_address         │◄──── From where
│ user_agent         │
│ details (JSON)     │◄──── Additional context
│ timestamp          │◄──── When
└────────────────────┘

┌────────────────────┐
│   Notification     │
├────────────────────┤
│ id (PK)            │
│ user_id (FK)       │
│ title              │
│ message            │
│ link_type          │
│ link_id            │
│ is_read            │
│ read_at            │
│ created_at         │
└────────────────────┘

┌────────────────────┐
│   RefreshToken     │
├────────────────────┤
│ id (PK)            │
│ token (UNIQUE)     │
│ user_id            │
│ expires_at         │
│ created_at         │
│ revoked_at         │
└────────────────────┘
```

## Tables Description

### Users Table

Stores user account information with role-based access control.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| email | VARCHAR | Unique email address |
| name | VARCHAR | Full name |
| password_hash | VARCHAR | Bcrypt hashed password |
| role | ENUM | ADMIN, SUPERVISOR, INVESTIGATOR |
| refresh_token | VARCHAR | JWT refresh token |
| created_at | TIMESTAMP | Account creation time |
| updated_at | TIMESTAMP | Last update time |
| last_login_at | TIMESTAMP | Last successful login |
| deleted_at | TIMESTAMP | Soft delete timestamp |

### Cases Table

Represents investigation cases containing evidence.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| case_number | VARCHAR | Unique case identifier (EVD-YYYY-XXXXX) |
| title | VARCHAR | Case title |
| description | TEXT | Detailed description |
| status | ENUM | OPEN, CLOSED, PENDING, ARCHIVED |
| priority | INT | 1 (highest) to 5 (lowest) |
| created_by_id | UUID | FK to user who created |
| assigned_investigator_id | UUID | FK to assigned investigator |
| created_at | TIMESTAMP | Case creation time |
| updated_at | TIMESTAMP | Last update time |
| closed_at | TIMESTAMP | When case was closed |
| deleted_at | TIMESTAMP | Soft delete timestamp |

### Evidence Table

Stores metadata about digital evidence files.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| file_name | VARCHAR | UUID-based storage filename |
| original_name | VARCHAR | Original uploaded filename |
| file_type | VARCHAR | MIME type |
| file_size | BIGINT | Size in bytes |
| storage_path | VARCHAR | Relative path to stored file |
| sha256_hash | VARCHAR | SHA-256 hash for integrity |
| encryption_iv | VARCHAR | AES-256 initialization vector |
| is_encrypted | BOOLEAN | Whether file is encrypted |
| status | ENUM | PENDING, APPROVED, REJECTED |
| reject_reason | VARCHAR | Reason if rejected |
| description | TEXT | Evidence description |
| case_id | UUID | FK to case |
| uploaded_by_id | UUID | FK to uploader |
| reviewed_by_id | UUID | FK to reviewer |
| reviewed_at | TIMESTAMP | Review timestamp |
| uploaded_at | TIMESTAMP | Upload timestamp |
| updated_at | TIMESTAMP | Last update time |
| deleted_at | TIMESTAMP | Soft delete timestamp |
| deleted_by_id | UUID | Who deleted |

### AuditLog Table (Chain of Custody)

**CRITICAL TABLE** - Records all actions for legal chain of custody.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | FK to user who performed action |
| action | ENUM | Type of action performed |
| entity | ENUM | Type of entity affected |
| entity_id | UUID | ID of affected entity |
| ip_address | VARCHAR | Client IP address |
| user_agent | VARCHAR | Browser/client identifier |
| details | JSON | Additional context |
| timestamp | TIMESTAMP | When action occurred |

**Note:** This table has NO deleted_at column - audit logs are permanent!

#### Audit Actions

- **Authentication:** LOGIN, LOGOUT, LOGIN_FAILED, PASSWORD_CHANGED
- **User Management:** USER_CREATED, USER_UPDATED, USER_DELETED
- **Case Operations:** CASE_CREATED, CASE_UPDATED, CASE_ASSIGNED, CASE_CLOSED, CASE_REOPENED, CASE_DELETED
- **Evidence Operations:** EVIDENCE_UPLOADED, EVIDENCE_DOWNLOADED, EVIDENCE_APPROVED, EVIDENCE_REJECTED, EVIDENCE_DELETED, EVIDENCE_INTEGRITY_CHECK, EVIDENCE_INTEGRITY_FAILED

### Notification Table

Stores user notifications for system events.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | FK to recipient user |
| title | VARCHAR | Notification title |
| message | TEXT | Notification content |
| link_type | VARCHAR | Type of linked entity |
| link_id | UUID | ID of linked entity |
| is_read | BOOLEAN | Read status |
| read_at | TIMESTAMP | When marked as read |
| created_at | TIMESTAMP | Creation time |

### RefreshToken Table

Manages JWT refresh tokens for secure authentication.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| token | VARCHAR | Unique token value |
| user_id | UUID | Associated user |
| expires_at | TIMESTAMP | Token expiration |
| created_at | TIMESTAMP | Token creation |
| revoked_at | TIMESTAMP | Revocation time (logout) |

## Indexes

Indexes are created for frequently queried columns:

- **Users:** email, role, deleted_at
- **Cases:** case_number, status, assigned_investigator_id, deleted_at
- **Evidence:** case_id, status, sha256_hash, deleted_at
- **AuditLog:** user_id, action, entity, entity_id, timestamp
- **Notification:** user_id, is_read, created_at
- **RefreshToken:** token, user_id, expires_at

## Soft Deletes

Most entities use soft deletes (`deleted_at` column) instead of hard deletes:

**Benefits:**
1. Data recovery is possible
2. Audit trail is preserved
3. Historical reports remain accurate
4. Legal requirements are met

**Implementation:**
- `deleted_at = NULL` means active
- `deleted_at = timestamp` means deleted
- All queries should filter `WHERE deleted_at IS NULL`

## Database Commands

```bash
# Generate Prisma Client
npm run prisma:generate

# Create migration (development)
npm run prisma:migrate

# Deploy migrations (production)
npm run prisma:migrate:prod

# Reset database (WARNING: destroys data)
npm run prisma:reset

# Seed database
npm run prisma:seed

# Open Prisma Studio (GUI)
npm run prisma:studio

# Full setup
npm run db:setup
```

## Security Considerations

1. **Password Storage:** All passwords are hashed using bcrypt with 12 salt rounds
2. **Evidence Integrity:** SHA-256 hashes ensure file integrity
3. **Encryption:** Optional AES-256 encryption for sensitive evidence
4. **Audit Trail:** Immutable audit logs for chain of custody
5. **Soft Deletes:** Evidence is never truly deleted

## Normalization

The schema follows Third Normal Form (3NF):

- No repeating groups (1NF)
- No partial dependencies (2NF)  
- No transitive dependencies (3NF)

Foreign keys maintain referential integrity across all relationships.

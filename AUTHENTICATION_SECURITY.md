# 🔒 Authentication, Session Management & Security Architecture

This document provides a comprehensive technical reference for the authentication, session lifecycle, token security, and audit systems powering the Enterprise POS and E-Commerce platform.

---

## 📑 Table of Contents

1. [Architectural Overview](#1-architectural-overview)
2. [Dual-Token Lifecycle & In-Memory Security](#2-dual-token-lifecycle--in-memory-security)
3. [Token Family Rotation & Reuse Detection](#3-token-family-rotation--reuse-detection)
4. [Server-Side Session Management](#4-server-side-session-management)
5. [Phone Number & PIN Authentication Specification](#5-phone-number--pin-authentication-specification)
6. [Super Admin Credential Exception](#6-super-admin-credential-exception)
7. [Brute-Force Protection & Account Lockout](#7-brute-force-protection--account-lockout)
8. [Sliding-Window Rate Limiting](#8-sliding-window-rate-limiting)
9. [Cross-Platform Cookie & CORS Architecture](#9-cross-platform-cookie--cors-architecture)
10. [Client-Side 401 Refresh Queue & Concurrency Mutex](#10-client-side-401-refresh-queue--concurrency-mutex)
11. [Audit & Security Event Logging](#11-audit--security-event-logging)
12. [Database Schema & Migrations](#12-database-schema--migrations)
13. [Zero-Downtime Secret Rotation & Production Checklist](#13-zero-downtime-secret-rotation--production-checklist)

---

## 1. Architectural Overview

The platform implements an **enterprise zero-trust token architecture** designed specifically for high-velocity retail POS environments and web storefronts. The legacy username/password authentication for retail staff has been replaced by an intuitive, high-speed **Phone Number + PIN** flow, while retaining strict username/password requirements for platform Super Administrators.

### Key Architectural Principles

- **Zero Persistent Access Tokens**: 15-minute JWT access tokens are stored strictly in volatile runtime memory (React state / client memory). They are **never** persisted to `localStorage`, `sessionStorage`, or mobile `AsyncStorage`, completely eliminating exposure to persistent XSS attacks.
- **Opaque, Hashed Refresh Tokens**: 7-day refresh tokens are 384-bit crypto-random opaque hex strings issued exclusively via `HttpOnly`, `Secure`, `SameSite=Strict` cookies. Only the SHA-256 fingerprint is stored in the database.
- **Token Family Rotation**: Every call to the refresh endpoint invalidates the incoming refresh token and issues a new one. Attempted reuse of an invalidated token triggers an immediate security alert and revokes all sessions in that family.
- **Server-Side Session Control**: Every active token family is anchored to a row in the `sessions` table. Administrators or users can instantly revoke specific sessions or trigger "Sign Out Everywhere" (`/api/auth/logout-all`).

---

## 2. Dual-Token Lifecycle & In-Memory Security

```
+-----------------------------------------------------------------------------------+
|                                 CLIENT RUNTIME                                    |
|                                                                                   |
|  +-------------------------------------+   +------------------------------------+  |
|  |       React Memory State            |   |          Native Cookie Jar         |  |
|  |  (Volatile, Reset on Page Reload)   |   |   (HttpOnly, Inaccessible to JS)   |  |
|  |                                     |   |                                    |  |
|  |  Access Token (15 min lifespan)     |   |  Refresh Token Cookie (7 days)     |  |
|  +-------------------------------------+   +------------------------------------+  |
+-------------------^-------------------------------------------^-------------------+
                    | Authorization: Bearer <token>             | Cookie: pos_refresh_token=...
                    |                                           | credentials: 'include'
+-------------------v-------------------------------------------v-------------------+
|                                 BACKEND API                                       |
|                                                                                   |
|  +-------------------------------------+   +------------------------------------+  |
|  |       Auth Middleware               |   |          Session Service           |  |
|  |  1. Verify HS256 signature          |   |  1. Hash incoming cookie (SHA-256) |  |
|  |  2. Check expiration (< 15 min)     |   |  2. Match active DB session        |  |
|  |  3. Validate session not revoked    |   |  3. Issue new Access + Refresh pair|  |
|  +-------------------------------------+   +------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### Access Token Specification

- **Type**: Standard JSON Web Token (JWT)
- **Algorithm**: `HS256` (HMAC with SHA-256)
- **Lifespan**: 15 minutes (`15m`)
- **Claims**:
  - `id`: Integer User ID
  - `role`: Role string (`seller`, `admin`, `super_admin`)
  - `business_id`: Integer Business ID or `null`
  - `shop_id`: Integer Shop ID or `null`
  - `session_id`: Unique Session identifier
  - `iat`: Issued At Unix timestamp
  - `exp`: Expiration Unix timestamp

### Refresh Token Specification

- **Type**: Cryptographically random opaque token (48 bytes / 96 hex characters generated via `crypto.randomBytes(48)`)
- **Lifespan**: 7 days (`604,800,000` milliseconds)
- **Storage in Database**: SHA-256 hex digest (`CHAR(64)`)
- **Transmission**: Set-Cookie header:
  ```http
  Set-Cookie: pos_refresh_token=<token>; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=604800
  ```

---

## 3. Token Family Rotation & Reuse Detection

To prevent token replay and interception attacks, every refresh operation executes a **strict rotation**:

1. Client sends `POST /api/auth/refresh` with the current HTTP-only cookie.
2. Backend computes `SHA-256(rawCookieToken)`.
3. Backend looks up the session in the database:
   - **Case A: Token matches current `refresh_token_hash`**:
     - A new opaque refresh token is generated.
     - The previous token is archived in `previous_token_hash`.
     - The session is updated with the new hash, rotation timestamp, and extended expiry.
     - A fresh 15-minute access token and updated cookie are returned to the client.
   - **Case B: Token matches `previous_token_hash` (Token Reuse Detected)**:
     - **Security Breach Detected**: An attacker or out-of-order request attempted to use an already-rotated token.
     - The entire session family is immediately marked `is_revoked = 1`.
     - An incident is recorded in `security_logs` with severity `CRITICAL` and event type `TOKEN_REUSE_DETECTED`.
     - Request is rejected with `401 Unauthorized` (`Invalid or compromised refresh token`).
   - **Case C: Token does not match any session or session revoked**:
     - Request is rejected with `401 Unauthorized`. Cookie is cleared.

---

## 4. Server-Side Session Management

Every session corresponds to a physical client login and is recorded in the `sessions` table:

```sql
CREATE TABLE `sessions` (
  `id` VARCHAR(50) PRIMARY KEY,
  `user_id` INT NOT NULL,
  `family_id` VARCHAR(50) NOT NULL,
  `refresh_token_hash` VARCHAR(64) NOT NULL,
  `previous_token_hash` VARCHAR(64) NULL,
  `device_type` VARCHAR(50) DEFAULT 'unknown',
  `user_agent` TEXT NULL,
  `ip_address` VARCHAR(45) NULL,
  `is_revoked` BOOLEAN NOT NULL DEFAULT FALSE,
  `revoked_reason` VARCHAR(100) NULL,
  `expires_at` TIMESTAMP NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_rotated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Session Endpoints

| Endpoint | Method | Role | Description |
| :--- | :--- | :--- | :--- |
| `/api/auth/logout` | `POST` | Authenticated | Revokes current session and clears HTTP-only cookie |
| `/api/auth/logout-all` | `POST` | Authenticated | Revokes all active sessions for the user across all devices |
| `/api/auth/sessions` | `GET` | Authenticated | Lists all active non-revoked sessions for current user |
| `/api/auth/sessions/:id` | `DELETE` | Authenticated | Revokes a specific session (e.g. lost phone or remote terminal) |

---

## 5. Phone Number & PIN Authentication Specification

For store operations (Admins and Sellers), authentication uses **Tanzanian Phone Number + 4-6 Digit Staff PIN**.

### Phone Number Format & Normalization

All phone numbers are validated and stored in canonical **E.164 format** (`+255XXXXXXXXX`).

#### Accepted Input Variants
- `0712 345 678` (Local 10-digit)
- `255712345678` (Country code without plus)
- `+255 712-345-678` (Full international with spaces/hyphens)
- `712345678` (9-digit national subscriber)

#### Tanzanian Mobile Operators Supported
| Operator | Prefixes (without +255) |
| :--- | :--- |
| **Vodacom** | `74`, `75`, `76` |
| **Airtel** | `78`, `68`, `69` |
| **Tigo / Yas** | `71`, `65`, `67`, `77` |
| **Halotel** | `62`, `61` |
| **TTCL** | `73` |

### PIN Security Specification

- **Length**: 4 to 6 numeric digits (`/^\d{4,6}$/`).
- **Hashing**: Salted bcrypt hash with cost factor 10 (`$2a$10$...`).
- **Verification**: Constant-time `bcrypt.compare` to prevent timing attacks.
- **Storage**: Stored in `pin_hash` column. Plaintext PINs are **never** logged, persisted, or returned in API responses.

---

## 6. Super Admin Credential Exception

Platform Super Administrators oversee multi-tenant businesses, global configurations, and critical infrastructure. Super Admin authentication retains strict credential standards:

- **Identifier**: `username` or `email`
- **Password**: Minimum 8 characters with at least one uppercase letter, one lowercase letter, one number, and one symbol (`/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/`).
- **Storage**: Salted bcrypt hash (`password_hash`).

---

## 7. Brute-Force Protection & Account Lockout

To protect PINs and passwords against automated dictionary and brute-force attacks:

1. **Progressive Delays**:
   - Every failed login attempt introduces an artificial, deliberate delay:
     $$\text{Delay} = \min(100 \times 2^{\text{attempts}}, 3000)\text{ ms}$$
2. **Temporary Account Lockout**:
   - **Trigger**: 5 consecutive failed login attempts on the same account.
   - **Duration**: 15 minutes (`locked_until = NOW() + INTERVAL 15 MINUTE`).
   - **Response**: HTTP `423 Locked` with message indicating remaining minutes.
3. **Reset on Success**:
   - Any valid authentication immediately clears `failed_login_attempts` to `0` and sets `locked_until = NULL`.

---

## 8. Sliding-Window Rate Limiting

The backend applies in-memory sliding-window rate limiters with clean IP extraction behind reverse proxies:

```javascript
// Rate Limiter Rules
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 20,           // Max 20 auth attempts per IP
  message: 'Too many authentication attempts from this IP address. Please try again later.'
});

export const generalApiLimiter = createRateLimiter({
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 120,          // Max 120 general API calls
  message: 'Rate limit exceeded. Please slow down your requests.'
});
```

---

## 9. Cross-Platform Cookie & CORS Architecture

The application operates across both **Web browsers** and **Native mobile runtimes (Android/iOS via Expo React Native)**.

### CORS Configuration (`src/app.js`)

```javascript
app.use(cors({
  origin: (origin, callback) => {
    // Allows web development origins and mobile app origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS origin not allowed'));
  },
  credentials: true, // MANDATORY: Enables HttpOnly cookies to pass
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Shop-Id',
    'x-shop-id',
    'Accept',
    'Origin',
    'X-Requested-With'
  ]
}));
```

### Mobile Runtime Cookie Jar
On Android (OkHttp) and iOS (NSURLSession), `fetch(url, { credentials: 'include' })` automatically stores and transmits cookies within the OS-managed secure cookie store. Application JavaScript cannot access, inspect, or modify the cookie, ensuring equivalent security guarantees across Web and Mobile.

---

## 10. Client-Side 401 Refresh Queue & Concurrency Mutex

When the 15-minute access token expires, multiple background and foreground API requests may simultaneously receive `401 Unauthorized`. To prevent race conditions and duplicate refresh requests, `src/services/api.ts` implements a **centralized refresh mutex queue**:

```typescript
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) prom.reject(error);
    else prom.resolve(token!);
  });
  failedQueue = [];
};
```

1. The first 401 response acquires `isRefreshing = true` and triggers `authApi.refresh()`.
2. All concurrent 401 requests are queued into `failedQueue`.
3. When the refresh call returns a new access token, the queue is drained and all original requests replay seamlessly.
4. If refresh fails (e.g. session revoked), the queue rejects and `onSessionExpired` triggers a clean logout redirect to the login screen.

---

## 11. Audit & Security Event Logging

The platform maintains two separate, append-only audit tables:

### Security Logs (`security_logs`)
Captures all authentication lifecycle events, lockouts, failures, and security violations:
- `LOGIN_SUCCESS_PHONE`, `LOGIN_SUCCESS_CREDENTIALS`
- `LOGIN_FAILED_INVALID_PIN`, `LOGIN_FAILED_INVALID_PASSWORD`, `LOGIN_FAILED_NOT_FOUND`
- `ACCOUNT_LOCKED_FAILED_ATTEMPTS`
- `TOKEN_REUSE_DETECTED` (Severity: `CRITICAL`)
- `SESSION_REVOKED`, `ALL_SESSIONS_REVOKED`

### Business Audit Logs (`audit_logs`)
Captures sensitive administrative and business domain events:
- User creation, role changes, and PIN resets
- Product price modifications and bulk stock adjustments
- Discount applications and transaction cancellations

---

## 12. Database Schema & Migrations

The database migration script `src/scripts/migrate-auth.js` is idempotent and safe for production:

```bash
npm run db:migrate
```

### User Table Alterations
```sql
ALTER TABLE `users`
  ADD COLUMN `phone_number` VARCHAR(20) NULL UNIQUE AFTER `email`,
  ADD COLUMN `pin_hash` VARCHAR(255) NULL AFTER `password_hash`,
  ADD COLUMN `profile_image` TEXT NULL AFTER `full_name`,
  ADD COLUMN `failed_login_attempts` INT NOT NULL DEFAULT 0 AFTER `status`,
  ADD COLUMN `locked_until` TIMESTAMP NULL AFTER `failed_login_attempts`;
```

---

## 13. Zero-Downtime Secret Rotation & Production Checklist

### Secret Rotation Procedure
When rotating JWT access secrets:
1. Generate new 256-bit secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Set existing secret as `OLD_JWT_SECRET` in `.env`.
3. Set new secret as `JWT_ACCESS_SECRET` in `.env`.
4. Deploy backend. Existing 15-minute tokens verify against `OLD_JWT_SECRET` until natural expiration, while all new tokens issue under `JWT_ACCESS_SECRET`.
5. After 15 minutes, remove `OLD_JWT_SECRET` from `.env`.

### Production Deployment Checklist
- [x] Set `NODE_ENV=production` in production `.env`.
- [x] Set `JWT_ACCESS_SECRET` to a high-entropy 64-character secret.
- [x] Configure explicit `CORS_ORIGIN` matching production domains.
- [x] Verify MySQL database index coverage on `sessions(refresh_token_hash)` and `users(phone_number)`.
- [x] Run `npm run db:migrate` prior to rolling out updated backend service.
- [x] Run `npm run test:auth` to verify all security assertions pass.

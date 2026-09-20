# Multi-Tier E-Commerce & POS Backend

Robust RESTful API backend for Multi-Tier E-Commerce and POS Mobile Application, built with Node.js, Express, and MySQL.

## Key Features

- **Strict RBAC Architecture**: Super Admin (Platform Overseer), Admin (Shop Manager), Seller (Retail Floor Operator).
- **Unique Alphanumeric ID Generation**: Cryptographic unambiguous character set generator (`PRD-SHP01-XXXX-XXXX`) used directly for product identification and camera scanning without separate barcodes.
- **ACID Compliant POS Checkout**: Row-level locking (`SELECT ... FOR UPDATE`), atomic inventory deduction, and audit log generation.
- **Automated Daily Analytics & Shrinkage**: End-of-day report compiling total units sold, revenue, profit, and inventory shrinkage (damage/loss/theft).
- **Full API Documentation**: See [API_DOCUMENTATION.md](API_DOCUMENTATION.md) for endpoint details and example payloads.

## Quick Start

### 1. Database Setup
Ensure MySQL is running (e.g., via WAMP, XAMPP, or standalone MySQL service).
Update `.env` if your database credentials differ from the defaults:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=pos_ecommerce_db
```

Initialize the database schema and seed data:
```bash
npm run db:init
```

Or import `schema.sql` and `seed.sql` directly into phpMyAdmin or MySQL CLI.

### 2. Start the Server
```bash
# Production mode
npm run start

# Development mode (nodemon)
npm run dev
```

The API server runs by default on `http://localhost:3000` (or `http://192.168.0.13:3000` on LAN).

### 3. Test ID Generator
```bash
npm run test:id
```

## 🔑 Authentication & Chosen Seed Credentials

The system implements a strict, hardened authentication policy across **all user roles**:
- **Identifier**: Phone Number ONLY (Tanzanian format `07XXXXXXXX` or international E.164 `+255XXXXXXXXX`)
- **Secret**: Exactly a **6-digit numeric PIN ONLY** (`123456`)

| Role | User / Full Name | Phone Number (Local) | Phone Number (E.164) | 6-Digit PIN | Assigned Shop / Scope |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | Alexander Cross (`superadmin`) | `0700 000 001` | `+255700000001` | `123456` | Platform Overseer (`/super-admin`) |
| **Shop Admin 1** | Marcus Vance (`admin_tech`) | `0712 100 001` | `+255712100001` | `123456` | Kariakoo Tech Hub (`/admin`) |
| **Shop Admin 2** | Elena Rostova (`admin_metro`) | `0712 100 002` | `+255712100002` | `123456` | Mlimani Boutique (`/admin`) |
| **POS Seller 1** | Alice Morgan (`seller_alice`) | `0712 200 001` | `+255712200001` | `123456` | Kariakoo Tech Hub (`/seller`) |
| **POS Seller 2** | Bob Kendrick (`seller_bob`) | `0712 200 002` | `+255712200002` | `123456` | Kariakoo Tech Hub (`/seller`) |
| **POS Seller 3** | Charlie Dupont (`seller_charlie`) | `0712 200 003` | `+255712200003` | `123456` | Mlimani Boutique (`/seller`) |

### Database Migration & Synchronization
To apply the database schema, add security tables, and automatically synchronize all seed user credentials to 6-digit PINs, run:
```bash
npm run db:migrate
```

### Environment Security Setup (`.env`)
Ensure `JWT_SECRET` is defined in your `.env` file:
```ini
JWT_SECRET=8f4e9b2c7a1d6f3e5b8c9a2d4f1e7b6c3a5d8f9e2b1c4a7d6f5e8b9c2a1d3f4
```
Or generate a new 256-bit cryptographically secure string:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
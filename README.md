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

## Default Seed Accounts
- **Super Admin**: `superadmin` / `SuperAdmin123!`
- **Admin (Shop 1)**: `admin_tech` / `Admin123!`
- **Admin (Shop 2)**: `admin_metro` / `Admin123!`
- **Seller (Shop 1)**: `seller_alice` / `Seller123!`
- **Seller (Shop 2)**: `seller_charlie` / `Seller123!`

Add the following line directly to your .env file in the root of your backend project folder.

Quick Copy-Paste (Fastest for Prototype)

Ini, TOML
JWT_SECRET=8f4e9b2c7a1d6f3e5b8c9a2d4f1e7b6c3a5d8f9e2b1c4a7d6f5e8b9c2a1d3f4
Generate a Custom Key
If you want to generate your own unique cryptographic string, run this command in your terminal:

Bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Copy the resulting output from the terminal and paste it into your .env file next to JWT_SECRET=.

Once saved, restart your Express server so it loads the new variable into process.env.
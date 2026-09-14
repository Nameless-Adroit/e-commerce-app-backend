# 📚 Multi-Tier E-Commerce & POS API Documentation

Comprehensive RESTful API reference for the Multi-Tier E-Commerce & Point of Sale (POS) application.

---

## 🌐 1. Overview & Setup

- **Base URL (Local):** `http://localhost:3000/api`
- **Base URL (LAN / Phone):** `http://192.168.0.13:3000/api` (configurable via `.env`)
- **Content-Type:** `application/json`
- **Authentication:** Bearer Token (`Authorization: Bearer <JWT_TOKEN>`)

### System Roles (RBAC)

| Role | Description | Scope |
| :--- | :--- | :--- |
| `super_admin` | Platform overseer. Global oversight across all independent shops and users. | System-wide (all shops) |
| `admin` | Shop manager. Manages product pricing, restocking, inventory, and staff. | Assigned Shop Only |
| `seller` | Retail floor operator. Scans products by ID, enters quantities, and completes checkout. | Assigned Shop Only |

### Default Seed Accounts

| Role | Username | Email | Password | Assigned Shop |
| :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | `superadmin` | `superadmin@system.com` | `SuperAdmin123!` | Global (All) |
| **Admin (Shop 1)** | `admin_tech` | `admin.tech@downtown.com` | `Admin123!` | Downtown Tech (SHP01) |
| **Admin (Shop 2)** | `admin_metro` | `admin.metro@fashion.com` | `Admin123!` | Metro Fashion (SHP02) |
| **Seller (Shop 1)** | `seller_alice` | `alice@downtown.com` | `Seller123!` | Downtown Tech (SHP01) |
| **Seller (Shop 1)** | `seller_bob` | `bob@downtown.com` | `Seller123!` | Downtown Tech (SHP01) |
| **Seller (Shop 2)** | `seller_charlie` | `charlie@fashion.com` | `Seller123!` | Metro Fashion (SHP02) |

---

## 🔐 2. Authentication & User Management (`/api/auth`)

### 2.1 Unified Login Portal
Authenticates users and returns the JWT token along with the role-specific redirect URL (SRS 3.1).

- **Endpoint:** `POST /api/auth/login`
- **Access:** Public
- **Request Body:** *(identifier can be either username or email)*
```json
{
  "identifier": "admin_tech",
  "password": "Admin123!"
}
```
- **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Authentication successful.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "redirect_url": "/dashboard/admin",
    "user": {
      "id": 2,
      "username": "admin_tech",
      "email": "admin.tech@downtown.com",
      "full_name": "Marcus Vance",
      "role": "admin",
      "shop_id": 1,
      "shop_name": "Downtown Tech & Gadgets",
      "shop_code": "SHP01"
    }
  }
}
```

*Role Redirection Targets:*
- `super_admin` ➔ `/dashboard/super-admin`
- `admin` ➔ `/dashboard/admin`
- `seller` ➔ `/dashboard/seller`

---

### 2.2 Get Current User Profile
- **Endpoint:** `GET /api/auth/profile`
- **Access:** Authenticated (Any Role)
- **Headers:** `Authorization: Bearer <TOKEN>`
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": 4,
    "username": "seller_alice",
    "email": "alice@downtown.com",
    "role": "seller",
    "full_name": "Alice Morgan",
    "shop_id": 1,
    "shop_name": "Downtown Tech & Gadgets",
    "shop_code": "SHP01"
  }
}
```

---

### 2.3 Register New User
- **Endpoint:** `POST /api/auth/users`
- **Access:** `super_admin` (can create all roles) or `admin` (can create sellers for assigned shop)
- **Request Body:** *(shop_id is optional for Admins as it is auto-inferred from their shop)*
```json
{
  "username": "seller_david",
  "email": "david@downtown.com",
  "password": "SellerPassword123!",
  "role": "seller",
  "shop_id": 1,
  "full_name": "David Miller"
}
```
- **Success Response (201 Created):**
```json
{
  "success": true,
  "message": "User successfully created.",
  "data": {
    "id": 7,
    "username": "seller_david",
    "email": "david@downtown.com",
    "role": "seller",
    "shop_id": 1,
    "full_name": "David Miller"
  }
}
```

---

## 🏷️ 3. Unique ID Generation & Product Management (`/api/products`)

> [!NOTE]
> The generated alphanumeric IDs serve directly as the primary identification code for scanning and inventory tracking without requiring separate barcodes.

### 3.1 Generate Unique Product ID
Generates a guaranteed unique, collision-free alphanumeric product ID based on shop code and entropy (SRS 3.2).

- **Endpoint:** `POST /api/products/generate-id`
- **Access:** `admin`, `super_admin`
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "product_id": "PRD-SHP01-3BSR-7RUR",
    "shop_code": "SHP01",
    "format": "PRD-[SHOP_CODE]-[TIMESTAMP]-[RANDOM][CHECKSUM]"
  }
}
```

---

### 3.2 List Products
Lists inventory with search, pagination, and stock filters. Scoped automatically to the caller's shop.

- **Endpoint:** `GET /api/products`
- **Access:** `admin`, `seller`, `super_admin`
- **Query Parameters:**
  - `search`: Filter by name, description, or product ID (e.g. `?search=charger`)
  - `category`: Filter by category (e.g. `?category=Audio`)
  - `low_stock`: `true` to view items at or below reorder level
  - `limit`: Number of results (default 50)
  - `offset`: Pagination offset (default 0)
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "id": "PRD-SHP01-3BSR-7RUR",
        "shop_id": 1,
        "name": "Wireless Noise-Cancelling Headphones",
        "description": "Over-ear active noise cancelling headphones",
        "category": "Audio",
        "price": 149.99,
        "cost_price": 85.00,
        "stock_quantity": 25,
        "reorder_level": 5,
        "shop_name": "Downtown Tech & Gadgets",
        "shop_code": "SHP01"
      }
    ],
    "pagination": { "total": 1, "limit": 50, "offset": 0 }
  }
}
```

---

### 3.3 Create Product with Generated ID
- **Endpoint:** `POST /api/products`
- **Access:** `admin`, `super_admin`
- **Request Body:** *(id is optional; if omitted, the server automatically generates a unique alphanumeric ID)*
```json
{
  "id": "PRD-SHP01-3BSR-7RUR",
  "name": "Magnetic Power Bank 10000mAh",
  "description": "Wireless fast-charging portable battery pack",
  "category": "Accessories",
  "price": 49.99,
  "cost_price": 22.50,
  "initial_stock": 30,
  "reorder_level": 5
}
```
- **Success Response (201 Created):**
```json
{
  "success": true,
  "message": "Product created successfully with unique ID.",
  "data": {
    "id": "PRD-SHP01-3BSR-7RUR",
    "shop_id": 1,
    "name": "Magnetic Power Bank 10000mAh",
    "category": "Accessories",
    "price": 49.99,
    "cost_price": 22.5,
    "stock_quantity": 30,
    "reorder_level": 5
  }
}
```

---

### 3.4 Scan / Lookup Product by ID
Used during scanning in POS or inventory audit.
- **Endpoint:** `GET /api/products/:id`
- **Access:** `admin`, `seller`, `super_admin`
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "PRD-SHP01-3BSR-7RUR",
    "name": "Wireless Noise-Cancelling Headphones",
    "price": 149.99,
    "stock_quantity": 25,
    "category": "Audio"
  }
}
```

---

### 3.5 Update Product Pricing & Information
- **Endpoint:** `PUT /api/products/:id`
- **Access:** `admin`, `super_admin`
- **Request Body:**
```json
{
  "price": 139.99,
  "cost_price": 80.00,
  "reorder_level": 8
}
```
- **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Product details updated successfully.",
  "data": {
    "id": "PRD-SHP01-3BSR-7RUR",
    "price": 139.99,
    "cost_price": 80.00,
    "reorder_level": 8
  }
}
```

---

### 3.6 Restock Product Inventory & Customer Returns
Increments existing product stock and records an audit trail in `inventory_logs` (SRS 3.2). Supports supplier restocks and customer returned items.
- **Endpoint:** `POST /api/products/:id/restock`
- **Access:** `admin`, `seller`, `super_admin`
- **Request Body:** *(change_type is optional: `'restock'` [default] or `'return'`)*
```json
{
  "quantity": 2,
  "reason": "[RETURN] Customer returned unopened item",
  "change_type": "return"
}
```
- **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Product stock incremented successfully.",
  "data": {
    "product_id": "PRD-SHP01-3BSR-7RUR",
    "name": "Wireless Noise-Cancelling Headphones",
    "previous_stock": 25,
    "restocked_quantity": 15,
    "new_stock": 40
  }
}
```

---

### 3.7 Record Inventory Shrinkage (Loss / Damage)
Records damaged or lost units and generates shrinkage data for daily reporting (SRS 3.4).
- **Endpoint:** `POST /api/products/:id/shrinkage`
- **Access:** `admin`, `super_admin`
- **Request Body:**
```json
{
  "quantity": 2,
  "reason": "Water damage in back storage area"
}
```
- **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Inventory shrinkage recorded successfully.",
  "data": {
    "product_id": "PRD-SHP01-3BSR-7RUR",
    "shrinkage_units": 2,
    "shrinkage_cost": "170.00",
    "previous_stock": 40,
    "new_stock": 38
  }
}
```

---

## 🛒 4. Point of Sale (POS) Workflow (`/api/pos`)

### 4.1 Scan Product ID with Camera
Seller scans or types the product ID to verify in-stock availability and price before adding to cart (SRS 3.3).
- **Endpoint:** `GET /api/pos/scan/:id`
- **Access:** `seller`, `admin`, `super_admin`
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "PRD-SHP01-3BSR-CHG4",
    "name": "65W GaN Fast Wall Charger",
    "category": "Accessories",
    "price": 34.99,
    "stock_quantity": 58,
    "is_in_stock": true,
    "low_stock_warning": false
  }
}
```

---

### 4.2 Checkout Transaction & Unit Deduction (ACID Transaction)
Executes an atomic checkout. Checks and locks product rows, inserts the transaction and line items, decrements the product stock counts, and writes sales logs (SRS 3.3).
- **Endpoint:** `POST /api/pos/checkout`
- **Access:** `seller`, `admin`, `super_admin`
- **Request Body:** *(payment_method can be `"cash"`, `"card"`, or `"mobile_money"`)*
```json
{
  "items": [
    {
      "productId": "PRD-SHP01-3BSR-CHG4",
      "quantity": 2
    },
    {
      "productId": "PRD-SHP01-3BSR-MOU9",
      "quantity": 1
    }
  ],
  "payment_method": "card",
  "notes": "Counter checkout"
}
```
- **Success Response (201 Created):**
```json
{
  "success": true,
  "message": "Transaction completed and inventory deducted successfully.",
  "data": {
    "transaction_id": "TXN-SHP01-20260913-7ESU",
    "shop_id": 1,
    "seller_id": 4,
    "total_amount": 99.97,
    "payment_method": "card",
    "status": "completed",
    "items_count": 2,
    "items": [
      {
        "product_id": "PRD-SHP01-3BSR-CHG4",
        "name": "65W GaN Fast Wall Charger",
        "quantity": 2,
        "unit_price": 34.99,
        "subtotal": 69.98,
        "remaining_stock": 56
      },
      {
        "product_id": "PRD-SHP01-3BSR-MOU9",
        "name": "Ergonomic Wireless Optical Mouse",
        "quantity": 1,
        "unit_price": 29.99,
        "subtotal": 29.99,
        "remaining_stock": 38
      }
    ]
  }
}
```

---

### 4.3 Transaction History
- **Endpoint:** `GET /api/pos/transactions`
- **Access:** `seller`, `admin`, `super_admin`
- **Query Parameters:** `limit`, `offset`, `start_date`, `end_date`
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "TXN-SHP01-20260913-7ESU",
        "shop_id": 1,
        "seller_name": "Alice Morgan",
        "total_amount": 99.97,
        "payment_method": "card",
        "status": "completed",
        "item_count": 2,
        "transaction_date": "2026-09-13 10:15:00"
      }
    ]
  }
}
```

---

### 4.4 Get Transaction Receipt Details
- **Endpoint:** `GET /api/pos/transactions/:id`
- **Access:** `seller`, `admin`, `super_admin`
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "TXN-SHP01-20260913-7ESU",
    "shop_id": 1,
    "shop_name": "Downtown Tech & Gadgets",
    "seller_name": "Alice Morgan",
    "total_amount": 99.97,
    "payment_method": "card",
    "items": [
      {
        "product_id": "PRD-SHP01-3BSR-CHG4",
        "product_name": "65W GaN Fast Wall Charger",
        "quantity": 2,
        "unit_price": 34.99,
        "subtotal": 69.98
      }
    ]
  }
}
```

---

## 📊 5. Analytics & Daily Reporting (`/api/analytics`)

### 5.1 Get Daily Sales & Shrinkage Report (SRS 3.4)
Compiles total units sold, revenue, net profit, and shrinkage for the day.
- **Endpoint:** `GET /api/analytics/daily`
- **Access:** `admin` (their shop), `super_admin` (cross-shop global view)
- **Query Parameters:** `date` (YYYY-MM-DD, defaults to current date)
- **Success Response (Admin - 200 OK):**
```json
{
  "success": true,
  "data": {
    "shop_id": 1,
    "report_date": "2026-09-13",
    "total_transactions": 2,
    "total_units_sold": 4,
    "revenue_generated": 189.96,
    "total_cost": 89.00,
    "net_profit": 100.96,
    "shrinkage_count": 2,
    "shrinkage_cost": 70.00,
    "compiled_at": "2026-09-13 12:00:00",
    "shop_name": "Downtown Tech & Gadgets",
    "shop_code": "SHP01"
  }
}
```
- **Success Response (Super Admin - 200 OK):**
```json
{
  "success": true,
  "data": {
    "report_date": "2026-09-13",
    "global_summary": {
      "reporting_shops": 2,
      "total_transactions": 3,
      "total_units_sold": 6,
      "total_revenue": 404.94,
      "total_cost": 192.50,
      "total_net_profit": 212.44,
      "total_shrinkage_count": 3,
      "total_shrinkage_cost": 78.50
    },
    "shop_breakdown": [
      {
        "shop_id": 1,
        "shop_name": "Downtown Tech & Gadgets",
        "total_transactions": 2,
        "total_revenue": 214.98,
        "net_profit": 112.48
      },
      {
        "shop_id": 2,
        "shop_name": "Metro Fashion & Apparel",
        "total_transactions": 1,
        "total_revenue": 189.96,
        "net_profit": 99.96
      }
    ]
  }
}
```

---

### 5.2 Trigger End-of-Day Close Compilation (SRS 3.4)
- **Endpoint:** `POST /api/analytics/daily/close`
- **Access:** `admin`, `super_admin`
- **Request Body (Optional):**
```json
{
  "date": "2026-09-13"
}
```

---

### 5.3 Historical Date Range Report
- **Endpoint:** `GET /api/analytics/range?start_date=2026-09-01&end_date=2026-09-13`
- **Access:** `admin`, `super_admin`

---

### 5.4 Top-Selling Products (Ranked Sales & Performance)
Retrieves the best-selling products ranked by total volume of units sold, along with revenue generated and current stock.
- **Endpoint:** `GET /api/analytics/top-products?limit=5`
- **Access:** `seller`, `admin`, `super_admin`
- **Query Parameters:** `limit` (optional integer, default `10`)
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "top_products": [
      {
        "product_id": "PRD-SHP01-3BSR-CHG4",
        "name": "Magnetic Power Bank 10000mAh",
        "category": "Accessories",
        "price": 49.99,
        "stock_quantity": 28,
        "shop_name": "Downtown Tech & Gadgets",
        "total_units_sold": 42,
        "total_revenue": 2099.58
      }
    ]
  }
}
```

---

## 🏢 6. Multi-Store Shop Management (`/api/shops`)

### 6.1 List All Shops (Super Admin)
- **Endpoint:** `GET /api/shops`
- **Access:** `super_admin`
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "shops": [
      {
        "id": 1,
        "shop_code": "SHP01",
        "name": "Downtown Tech & Gadgets",
        "address": "100 Innovation Way, Suite 4B",
        "phone": "+1-555-0101",
        "staff_count": 3,
        "product_count": 6,
        "total_units_in_stock": 220
      }
    ]
  }
}
```

---

### 6.2 Create Shop
- **Endpoint:** `POST /api/shops`
- **Access:** `super_admin`
- **Request Body:**
```json
{
  "shop_code": "SHP03",
  "name": "Uptown Supermarket & Groceries",
  "address": "780 North Avenue",
  "phone": "+1-555-0199"
}
```

---

## 🛠️ 7. CLI Scripts Reference

| Command | Description |
| :--- | :--- |
| `npm run start` | Start server in production mode |
| `npm run dev` | Start server in development mode with nodemon auto-reload |
| `npm run db:init` | Run `schema.sql` and `seed.sql` to initialize database from scratch |
| `npm run db:seed` | Re-seed initial sample data into an existing database |
| `npm run test:id` | Test unique alphanumeric ID generator logic directly in terminal |

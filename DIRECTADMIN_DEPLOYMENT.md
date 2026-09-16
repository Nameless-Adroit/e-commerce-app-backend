# DirectAdmin Backend Deployment Guide

This guide outlines the complete, step-by-step process for deploying the POS & E-Commerce Express backend to a live server running **DirectAdmin**.

---

## 1. DirectAdmin MySQL Database Setup

Shared hosting on DirectAdmin prefixes databases and database users with your account username (e.g., `jmsoluti_`).

1. Log into your **DirectAdmin Control Panel**.
2. Navigate to **Account Manager** > **MySQL Management** (or **Databases**).
3. Click **Create New Database**:
   - **Database Name**: `pos_ecommerce` (Full name: `jmsoluti_pos_ecommerce`)
   - **Database User**: `pos_ecommerce` (Full username: `jmsoluti_pos_ecommerce`)
   - **Database Password**: Click *Random* or enter a strong password (save this securely).
   - Click **Create Database**.
4. Open **phpMyAdmin** from DirectAdmin:
   - Select your newly created database (`jmsoluti_pos_ecommerce`) from the left sidebar.
   - Click the **Import** tab at the top.
   - Click **Choose File**, select `schema.sql`, and click **Go** / **Import**.
   - Next, select `seed.sql` and click **Go** / **Import** to populate default shops, products, and users.

---

## 2. Prepare & Upload Backend Files

Upload the backend files to your server using **DirectAdmin File Manager** or **FTP/SFTP** (e.g., FileZilla).

### Files to Include:
```
backend/
├── src/
├── app.js
├── package.json
├── package-lock.json
├── schema.sql
├── seed.sql
└── .env
```
*(Do **NOT** upload the local `node_modules` folder; packages will be installed directly on the server).*

### Recommended Directory:
- Create a folder outside or inside public_html:
  `/home/YOUR_USERNAME/pos-backend`
  or
  `/home/YOUR_USERNAME/domains/api.yourdomain.com/public_html`

---

## 3. Configure Production Environment Variables (`.env`)

In your uploaded backend folder on the server, create or edit the `.env` file:

```env
# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# MySQL Database Configuration (From DirectAdmin MySQL Management)
DB_HOST=localhost
DB_PORT=3306
DB_USER=jmsoluti_pos_ecommerce
DB_PASSWORD=YourDatabasePasswordHere
DB_NAME=jmsoluti_pos_ecommerce

# Security / Authentication (64-character secret)
JWT_SECRET=b7e1ecdbee0d2f2d6b4d6ecc70380a1182c8c2571a671e9e5a4b14b27bb8507b
JWT_EXPIRES_IN=8h

# Allowed Origins for CORS (Your frontend domain, or comma-separated)
ALLOWED_ORIGINS=https://yourdomain.com,https://api.yourdomain.com

# ID Generation Config
ID_CHARSET=23456789ABCDEFGHJKLMNPQRSTUVWXYZ
PRODUCT_ID_PREFIX=PRD
TRANSACTION_ID_PREFIX=TXN
```

---

## 4. Setting up the Node.js Application in DirectAdmin

Most DirectAdmin servers provide the **"Setup Node.js App"** tool (powered by CloudLinux Passenger).

1. In DirectAdmin, navigate to **Extra Features** > **Setup Node.js App**.
2. Click **Create Application**:
   - **Node.js version**: Select **`20.x`** (or `18.x` LTS).
   - **Application mode**: Select **`Production`**.
   - **Application root**: Enter the relative path to your backend folder (e.g. `pos-backend` or `domains/api.yourdomain.com/public_html`).
   - **Application URL**: Select the domain/subdomain where the API should live (e.g., `api.yourdomain.com` or `yourdomain.com/api`).
   - **Application startup file**: Enter **`app.js`** (or `src/server.js`).
3. Click **Create** (or **Save**).
4. In the application dashboard, click **Run NPM Install** (or enter the terminal command shown at the top of the page).
5. Click **Restart** to boot up the application.

---

## 5. Enable Free SSL (HTTPS)

DirectAdmin provides free Let's Encrypt SSL certificates.

1. Navigate to **Account Manager** > **SSL Certificates**.
2. Select **Free & automatic certificate from Let's Encrypt**.
3. Select your API domain/subdomain (e.g., `api.yourdomain.com`).
4. Click **Save**.
5. Enable **Force SSL / HTTPS Redirection**.

---

## 6. Verify Deployment

Test that the live backend is responding:

```bash
curl https://api.yourdomain.com/api/health
```

Expected JSON response:
```json
{
  "status": "healthy",
  "service": "Multi-Tier E-Commerce & POS API",
  "module_system": "ES Modules",
  "environment": "production"
}
```

---

## 7. Connect the Mobile App / Frontend

Once your backend is live:
1. Open the mobile app on the login screen.
2. Tap the **Server Config** icon (`⚙️` or server button) in the header.
3. Update the Server URL to your live HTTPS endpoint:
   `https://api.yourdomain.com/api`
4. Tap **Save & Test Connection**.
5. Log in with your production credentials.

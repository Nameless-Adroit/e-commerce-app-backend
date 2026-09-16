import app from './app.js';
import { testConnection } from './config/database.config.js';

// Support both standard TCP ports and CloudLinux / Passenger / DirectAdmin Unix socket paths
const rawPort = process.env.PORT || 3000;
const isUnixSocket = typeof rawPort === 'string' && isNaN(Number(rawPort));
const PORT = isUnixSocket ? rawPort : parseInt(rawPort, 10);
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
  console.log('🚀 Starting POS & E-Commerce API Backend (ES Modules)...');

  // 1. Bind to Passenger socket or TCP port immediately
  if (isUnixSocket) {
    // CloudLinux / Passenger Unix domain socket (DirectAdmin Node App)
    app.listen(PORT, () => {
      console.log(`📡 Server listening on Passenger socket: ${PORT}`);
      console.log(`🔐 RBAC Roles active: super_admin, admin, seller`);
    });
  } else {
    // Standard TCP port (Local development or PM2 / reverse proxy)
    app.listen(PORT, HOST, () => {
      console.log(`📡 Server listening on http://${HOST}:${PORT}`);
      console.log(`🔐 RBAC Roles active: super_admin, admin, seller`);
    });
  }

  // 2. Test database connection in background
  try {
    await testConnection();
  } catch (err) {
    console.error('⚠️ Database connection notice at startup:', err.message);
  }
}

startServer();

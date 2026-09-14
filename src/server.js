import app from './app.js';
import { testConnection } from './config/database.js';

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
  console.log('🚀 Starting POS & E-Commerce API Backend (ES Modules)...');

  // Test database connection
  await testConnection();

  app.listen(PORT, HOST, () => {
    console.log(`📡 Server listening on http://${HOST}:${PORT}`);
    console.log(`📡 Local machine access: http://localhost:${PORT}`);
    console.log(`📱 LAN phone access:    http://192.168.0.13:${PORT}`);
    console.log(`📄 API Documentation:   API_DOCUMENTATION.md`);
    console.log(`🔐 RBAC Roles active:   super_admin, admin, seller`);
  });
}

startServer();

import assert from 'assert';
import { testConnection, query } from '../config/database.config.js';
import * as authService from '../services/auth.service.js';
import * as shopService from '../services/shop.service.js';
import { ROLES } from '../config/constants.js';

let passedTests = 0;
let failedTests = 0;

async function reportAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🏪 RUNNING SHOP REQUEST & APPROVAL WORKFLOW TESTS');
  console.log('======================================================\n');

  // Test DB connectivity
  const connected = await testConnection();
  if (!connected) {
    console.log('  ⚠️ Database server not reachable locally; skipping live database integration tests.');
    console.log('\n======================================================');
    console.log(`📊 RESULTS: Tests completed (DB offline locally)`);
    console.log('======================================================\n');
    return;
  }

  // 1. Authenticate Admin and Super Admin
  let adminUser;
  let superAdminUser;

  await reportAsync('Admin logs in with Phone & PIN', async () => {
    const res = await authService.loginWithPhoneAndPin({
      phoneNumber: '0712 100 001',
      pin: '123456',
      ipAddress: '127.0.0.1',
      userAgent: 'TestClient/1.0'
    });
    assert.ok(res.token, 'Token must be issued');
    assert.strictEqual(res.user.role, ROLES.ADMIN);
    adminUser = res.user;
  });

  await reportAsync('Super Admin logs in with Phone & PIN', async () => {
    const res = await authService.loginWithPhoneAndPin({
      phoneNumber: '0700 000 001',
      pin: '123456',
      ipAddress: '127.0.0.1',
      userAgent: 'TestClient/1.0'
    });
    assert.ok(res.token, 'Token must be issued');
    assert.strictEqual(res.user.role, ROLES.SUPER_ADMIN);
    superAdminUser = res.user;
  });

  // 2. Direct createShop restriction for Admin
  await reportAsync('Store Admin direct createShop throws 403 Forbidden', async () => {
    try {
      await shopService.createShop({
        currentUser: adminUser,
        shopData: {
          shop_code: 'TESTFORBIDDEN',
          name: 'Forbidden Store'
        }
      });
      assert.fail('Expected 403 error for direct shop creation by Admin');
    } catch (err) {
      assert.strictEqual(err.statusCode, 403, `Expected 403, got ${err.statusCode}`);
    }
  });

  // 3. Admin submits shop creation request
  const testCode = `REQ${Date.now().toString().slice(-4)}`;
  let createdRequestId;

  await reportAsync('Admin submits new store branch request', async () => {
    const res = await shopService.submitShopRequest({
      currentUser: adminUser,
      requestData: {
        shop_code: testCode,
        name: `Test Outlet ${testCode}`,
        address: 'Clock Tower Arusha',
        phone: '+255788999888',
        admin_notes: 'Expansion into Northern Region'
      }
    });

    assert.ok(res.id, 'Request ID must be returned');
    assert.strictEqual(res.status, 'pending');
    assert.strictEqual(res.shop_code, testCode);
    assert.strictEqual(res.business_id, adminUser.business_id);
    createdRequestId = res.id;
  });

  // 4. Duplicate pending code throws 409
  await reportAsync('Submitting duplicate pending request throws 409 Conflict', async () => {
    try {
      await shopService.submitShopRequest({
        currentUser: adminUser,
        requestData: {
          shop_code: testCode,
          name: 'Duplicate Outlet'
        }
      });
      assert.fail('Expected 409 error for duplicate code');
    } catch (err) {
      assert.strictEqual(err.statusCode, 409, `Expected 409, got ${err.statusCode}`);
    }
  });

  // 5. Admin lists shop requests (scoped to business)
  await reportAsync('Admin lists own business requests', async () => {
    const reqs = await shopService.getShopRequests({
      currentUser: adminUser
    });
    assert.ok(Array.isArray(reqs));
    const found = reqs.find(r => r.id === createdRequestId);
    assert.ok(found, 'Created request must be found in admin query');
    assert.strictEqual(found.status, 'pending');
  });

  // 6. Super Admin lists all requests
  await reportAsync('Super Admin lists all requests across platform', async () => {
    const reqs = await shopService.getShopRequests({
      currentUser: superAdminUser
    });
    assert.ok(Array.isArray(reqs));
    const found = reqs.find(r => r.id === createdRequestId);
    assert.ok(found, 'Super Admin must see the pending request');
  });

  // 7. Super Admin approves shop request
  let approvedShopId;
  await reportAsync('Super Admin approves shop request and instantiates shop', async () => {
    const res = await shopService.approveShopRequest({
      currentUser: superAdminUser,
      requestId: createdRequestId,
      superAdminNotes: 'Approved for Q3 rollout'
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.shop_id, 'New shop ID must be returned');
    approvedShopId = res.shop_id;

    // Verify shop exists in shops table
    const shops = await query('SELECT * FROM shops WHERE id = ?', [approvedShopId]);
    assert.strictEqual(shops.length, 1, 'Shop must be instantiated in database');
    assert.strictEqual(shops[0].shop_code, testCode);
  });

  // 8. Re-approving already approved request throws 400
  await reportAsync('Re-approving already approved request throws 400 Bad Request', async () => {
    try {
      await shopService.approveShopRequest({
        currentUser: superAdminUser,
        requestId: createdRequestId
      });
      assert.fail('Expected 400 error');
    } catch (err) {
      assert.strictEqual(err.statusCode, 400, `Expected 400, got ${err.statusCode}`);
    }
  });

  // 9. Admin submits another request and Super Admin rejects it
  const rejectCode = `REJ${Date.now().toString().slice(-4)}`;
  let rejectRequestId;

  await reportAsync('Super Admin rejects shop request with feedback notes', async () => {
    const req = await shopService.submitShopRequest({
      currentUser: adminUser,
      requestData: {
        shop_code: rejectCode,
        name: `Reject Outlet ${rejectCode}`
      }
    });
    rejectRequestId = req.id;

    const res = await shopService.rejectShopRequest({
      currentUser: superAdminUser,
      requestId: rejectRequestId,
      superAdminNotes: 'Please revise location feasibility study.'
    });

    assert.strictEqual(res.success, true);

    const rows = await query('SELECT * FROM shop_requests WHERE id = ?', [rejectRequestId]);
    assert.strictEqual(rows[0].status, 'rejected');
    assert.strictEqual(rows[0].super_admin_notes, 'Please revise location feasibility study.');
  });

  // Clean up test data
  if (approvedShopId) {
    await query('DELETE FROM shops WHERE id = ?', [approvedShopId]);
  }
  await query('DELETE FROM shop_requests WHERE id IN (?, ?)', [createdRequestId, rejectRequestId]);

  console.log('\n======================================================');
  console.log(`📊 RESULTS: ${passedTests} Passed, ${failedTests} Failed`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });

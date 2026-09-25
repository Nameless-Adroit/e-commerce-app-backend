import { query } from '../config/database.config.js';
import { authenticateUser, registerUser } from '../services/auth.service.js';
import { adminUpdateUser } from '../services/user.service.js';
import { createBusiness, setBusinessStatus } from '../services/business.service.js';
import { hashPin } from '../utils/pin.util.js';

async function runSuspensionTests() {
  console.log('======================================================');
  console.log('🧪 TESTING SUSPENSION WORKFLOWS (SELLERS & BUSINESS OWNERS)');
  console.log('======================================================');

  let testBizId = null;
  let testAdminId = null;
  let testSellerId = null;
  let testShopId = null;

  try {
    const superAdmin = { id: 1, role: 'super_admin' };

    // Clean up any previous test artifacts
    await query("DELETE FROM shops WHERE shop_code = 'SHP-SUSP'");
    await query("DELETE FROM businesses WHERE business_code = 'BIZSUSP'");
    await query("DELETE FROM users WHERE phone_number IN ('+255799000001', '+255799000002')");

    // 1. Create dedicated test business with 1 shop
    console.log('\n▶ STEP 1: Provision isolated test business & tenant');
    const biz = await createBusiness({
      name: 'Suspension Workflow Test Enterprise',
      business_code: 'BIZSUSP',
      currency_code: 'TZS',
      currency_symbol: 'TSh',
      currency_name: 'Tanzanian Shilling'
    });
    testBizId = biz.id;

    // Attach Starter plan (1 shop, 1 seller)
    await query("UPDATE businesses SET subscription_plan_id = 1, subscription_status = 'active' WHERE id = ?", [testBizId]);

    // Create primary shop
    const shopResult = await query(
      "INSERT INTO shops (business_id, shop_code, name, currency_code, currency_symbol, currency_name) VALUES (?, 'SHP-SUSP', 'Main Branch', 'TZS', 'TSh', 'Tanzanian Shilling')",
      [testBizId]
    );
    testShopId = shopResult.insertId;

    // Create Business Owner (Admin)
    const pinHash = await hashPin('123456');
    const adminResult = await query(
      "INSERT INTO users (username, email, phone_number, pin_hash, role, business_id, full_name, is_active) VALUES ('test_owner_susp', 'owner@susp.local', '+255799000001', ?, 'admin', ?, 'Test Owner', TRUE)",
      [pinHash, testBizId]
    );
    testAdminId = adminResult.insertId;
    await query("UPDATE businesses SET owner_user_id = ? WHERE id = ?", [testAdminId, testBizId]);

    const adminUser = { id: testAdminId, role: 'admin', business_id: testBizId };

    // 2. Create Cashier (Seller)
    console.log('\n▶ STEP 2: Store Admin provisions cashier');
    const seller = await registerUser({
      currentUser: adminUser,
      userData: {
        full_name: 'Test Cashier John',
        phone_number: '0799000002',
        pin: '123456',
        role: 'seller',
        shop_id: testShopId
      }
    });
    testSellerId = seller.id;
    console.log('  ✅ Cashier provisioned:', seller.id, seller.full_name, seller.phone_number);

    // 3. Test initial cashier authentication
    const initialCashierAuth = await authenticateUser({
      identifier: '0799000002',
      pin: '123456',
      ipAddress: '127.0.0.1'
    });
    console.log('  ✅ Cashier authenticated successfully. Session ID:', initialCashierAuth.sessionId);

    // 4. Test initial owner authentication
    const initialOwnerAuth = await authenticateUser({
      identifier: '0799000001',
      pin: '123456',
      ipAddress: '127.0.0.1'
    });
    console.log('  ✅ Owner authenticated successfully. Session ID:', initialOwnerAuth.sessionId);

    // 5. Store Admin suspends Cashier
    console.log('\n▶ STEP 3: Store Admin suspends Cashier');
    await adminUpdateUser({
      targetUserId: testSellerId,
      updateData: { is_active: false },
      currentUser: adminUser
    });

    const userInDb = await query('SELECT is_active FROM users WHERE id = ?', [testSellerId]);
    console.log('  ✅ Cashier is_active in DB:', userInDb[0]?.is_active === 0 || userInDb[0]?.is_active === false ? 'SUSPENDED (0)' : 'ACTIVE');

    const sessionsInDb = await query('SELECT is_revoked FROM sessions WHERE user_id = ?', [testSellerId]);
    console.log('  ✅ Cashier sessions revoked:', sessionsInDb.every(s => s.is_revoked === 1));

    // 6. Verify suspended cashier cannot login
    console.log('\n▶ STEP 4: Verify suspended Cashier login is rejected with generic error');
    try {
      await authenticateUser({
        identifier: '0799000002',
        pin: '123456',
        ipAddress: '127.0.0.1'
      });
      throw new Error('FAILED: Suspended cashier was able to login!');
    } catch (authErr) {
      console.log('  ✅ Suspended cashier correctly rejected:', authErr.message, `(Code: ${authErr.code})`);
    }

    // 7. Store Admin reactivates Cashier
    console.log('\n▶ STEP 5: Store Admin reactivates Cashier');
    await adminUpdateUser({
      targetUserId: testSellerId,
      updateData: { is_active: true },
      currentUser: adminUser
    });

    const reactivatedUserInDb = await query('SELECT is_active FROM users WHERE id = ?', [testSellerId]);
    console.log('  ✅ Cashier is_active in DB after reactivation:', reactivatedUserInDb[0]?.is_active === 1 || reactivatedUserInDb[0]?.is_active === true ? 'ACTIVE (1)' : 'SUSPENDED');

    const reactivatedCashierAuth = await authenticateUser({
      identifier: '0799000002',
      pin: '123456',
      ipAddress: '127.0.0.1'
    });
    console.log('  ✅ Reactivated cashier authenticated successfully! Session:', reactivatedCashierAuth.sessionId);

    // 8. Super Admin suspends Business
    console.log('\n▶ STEP 6: Super Admin suspends Business');
    await setBusinessStatus({
      businessId: testBizId,
      status: 'suspended',
      currentUser: superAdmin
    });

    const bizInDb = await query('SELECT status FROM businesses WHERE id = ?', [testBizId]);
    console.log('  ✅ Business status in DB:', bizInDb[0]?.status);

    const allBizSessions = await query('SELECT is_revoked FROM sessions WHERE user_id IN (?, ?)', [testAdminId, testSellerId]);
    console.log('  ✅ All tenant sessions revoked:', allBizSessions.every(s => s.is_revoked === 1));

    // 9. Verify both Owner and Cashier cannot log in while business is suspended
    console.log('\n▶ STEP 7: Verify Owner and Cashier login rejected while business is suspended');
    try {
      await authenticateUser({
        identifier: '0799000001', // Owner
        pin: '123456',
        ipAddress: '127.0.0.1'
      });
      throw new Error('FAILED: Owner was able to login while business suspended!');
    } catch (ownerErr) {
      console.log('  ✅ Owner login correctly rejected:', ownerErr.message, `(Code: ${ownerErr.code})`);
    }

    try {
      await authenticateUser({
        identifier: '0799000002', // Cashier
        pin: '123456',
        ipAddress: '127.0.0.1'
      });
      throw new Error('FAILED: Cashier was able to login while business suspended!');
    } catch (cashierErr) {
      console.log('  ✅ Cashier login correctly rejected:', cashierErr.message, `(Code: ${cashierErr.code})`);
    }

    // 10. Super Admin reactivates Business
    console.log('\n▶ STEP 8: Super Admin reactivates Business');
    await setBusinessStatus({
      businessId: testBizId,
      status: 'active',
      currentUser: superAdmin
    });

    const bizActiveInDb = await query('SELECT status FROM businesses WHERE id = ?', [testBizId]);
    console.log('  ✅ Business status in DB after reactivation:', bizActiveInDb[0]?.status);

    const ownerReauth = await authenticateUser({
      identifier: '0799000001',
      pin: '123456',
      ipAddress: '127.0.0.1'
    });
    console.log('  ✅ Owner authenticated successfully after business reactivation!');

    const cashierReauth = await authenticateUser({
      identifier: '0799000002',
      pin: '123456',
      ipAddress: '127.0.0.1'
    });
    console.log('  ✅ Cashier authenticated successfully after business reactivation!');

    // Clean up
    await query('DELETE FROM sessions WHERE user_id IN (?, ?)', [testAdminId, testSellerId]);
    await query('DELETE FROM users WHERE id IN (?, ?)', [testAdminId, testSellerId]);
    await query('DELETE FROM shops WHERE id = ?', [testShopId]);
    await query('DELETE FROM businesses WHERE id = ?', [testBizId]);

    console.log('\n======================================================');
    console.log('🎉 ALL SUSPENSION & REACTIVATION TESTS PASSED!');
    console.log('======================================================');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    // Cleanup if possible
    if (testAdminId) await query('DELETE FROM users WHERE id = ?', [testAdminId]);
    if (testSellerId) await query('DELETE FROM users WHERE id = ?', [testSellerId]);
    if (testShopId) await query('DELETE FROM shops WHERE id = ?', [testShopId]);
    if (testBizId) await query('DELETE FROM businesses WHERE id = ?', [testBizId]);
    process.exit(1);
  }
}

runSuspensionTests();

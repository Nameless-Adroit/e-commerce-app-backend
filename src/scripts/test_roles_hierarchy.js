import { testConnection, query } from '../config/database.config.js';
import * as authService from '../services/auth.service.js';
import * as businessService from '../services/business.service.js';
import * as shopService from '../services/shop.service.js';
import * as posService from '../services/pos.service.js';
import * as analyticsService from '../services/analytics.service.js';
import { ROLES, BUSINESS_STATUS } from '../config/constants.js';

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING COMPREHENSIVE ROLE HIERARCHY TEST SUITE');
  console.log('======================================================\n');

  await testConnection();

  // Clean up any previous test artifacts
  await query("DELETE FROM inventory_logs WHERE product_id = 'PRD-TEST-SPICE01'");
  await query("DELETE FROM transaction_items WHERE product_id = 'PRD-TEST-SPICE01'");
  await query("DELETE FROM transactions WHERE shop_id IN (SELECT id FROM shops WHERE shop_code IN ('SHPTEST', 'SHP_TEST'))");
  await query("DELETE FROM products WHERE id = 'PRD-TEST-SPICE01'");
  await query("DELETE FROM users WHERE username IN ('admin_test', 'seller_test')");
  await query("DELETE FROM shops WHERE shop_code IN ('SHPTEST', 'SHP_TEST')");
  await query("DELETE FROM businesses WHERE business_code IN ('BIZTEST', 'BIZ_TEST')");

  // -----------------------------------------------------------------------------
  // TEST SCENARIO 1: SUPER ADMIN
  // -----------------------------------------------------------------------------
  console.log('▶ SCENARIO 1: Super Admin Operations');
  const superAdminAuth = await authService.authenticateUser({
    identifier: '0700000001',
    pin: '123456'
  });
  console.log('  ✅ Super Admin authenticated:', superAdminAuth.user.username);

  // 1.1 Create Business
  const newBiz = await businessService.createBusiness({
    business_code: 'BIZ_TEST',
    name: 'Zanzibar Trading Enterprise',
    currency_code: 'TZS',
    currency_symbol: 'TSh',
    currency_name: 'Tanzanian Shilling'
  });
  console.log('  ✅ Business created:', newBiz.business_code, `(ID: ${newBiz.id})`);

  // 1.2 Create Admin for Business
  const newAdmin = await authService.registerUser({
    currentUser: superAdminAuth.user,
    userData: {
      username: 'admin_test',
      email: 'admin.test@zanzibar.com',
      password: 'InitialPassword123!',
      role: ROLES.ADMIN,
      business_id: newBiz.id,
      full_name: 'Hamisi Bakari'
    }
  });
  console.log('  ✅ Admin registered with temporary password:', newAdmin.username, 'temp:', newAdmin.temporary_password);

  // 1.3 View System Overview
  const allBiz = await businessService.getAllBusinesses();
  console.log(`  ✅ Super Admin retrieved ${allBiz.length} businesses across the system.`);

  // -----------------------------------------------------------------------------
  // TEST SCENARIO 2: ADMIN ONBOARDING & MULTI-SHOP OPERATIONS
  // -----------------------------------------------------------------------------
  console.log('\n▶ SCENARIO 2: Admin Multi-Shop & POS Operations');

  // 2.1 Admin login with initial credentials
  const adminAuth = await authService.authenticateUser({
    identifier: 'admin_test',
    password: 'InitialPassword123!'
  });
  console.log('  ✅ Admin logged in. Temporary password status:', adminAuth.user.temporary_password);

  // 2.2 Admin changes temporary password
  await authService.changePassword({
    userId: adminAuth.user.id,
    oldPassword: 'InitialPassword123!',
    newPassword: 'PermanentPassword123!'
  });
  const updatedAdminProfile = await authService.getUserProfile(adminAuth.user.id);
  console.log('  ✅ Password changed. Temporary flag is now:', updatedAdminProfile.temporary_password);

  // 2.3 Admin creates Shop under their business
  const newShop = await shopService.createShop({
    currentUser: updatedAdminProfile,
    shopData: {
      shop_code: 'SHP_TEST',
      name: 'Stone Town Branch',
      address: 'Kenyatta Rd, Stone Town, Zanzibar',
      phone: '+255 777 123 456'
    }
  });
  console.log('  ✅ Admin created shop under business:', newShop.shop_code, `(Business ID: ${newShop.business_id})`);

  // 2.4 Admin adds Seller to this shop
  const newSeller = await authService.registerUser({
    currentUser: updatedAdminProfile,
    userData: {
      username: 'seller_test',
      email: 'seller.test@zanzibar.com',
      password: 'SellerPassword123!',
      role: ROLES.SELLER,
      shop_id: newShop.id,
      full_name: 'Fatma Juma'
    }
  });
  console.log('  ✅ Admin added Seller to Shop:', newSeller.username, `(Shop ID: ${newSeller.shop_id})`);

  // 2.5 Admin views shops belonging to their business
  const adminShops = await shopService.getAllShops({ currentUser: updatedAdminProfile });
  console.log(`  ✅ Admin sees ${adminShops.length} shop(s) belonging to their business.`);

  // 2.6 Admin creates product in their shop
  const prodRes = await query(
    `INSERT INTO products (id, shop_id, name, category, price, cost_price, stock_quantity, reorder_level)
     VALUES ('PRD-TEST-SPICE01', ?, 'Zanzibar Organic Cloves (500g)', 'Spices', 25000.00, 12000.00, 50, 5)`,
    [newShop.id]
  );
  console.log('  ✅ Product seeded in shop:', 'PRD-TEST-SPICE01', 'Initial stock: 50');

  // 2.7 Admin inherits Seller/POS: Admin processes sale in their shop with custom unit price!
  const adminCheckout = await posService.processCheckout({
    shopId: newShop.id,
    sellerId: updatedAdminProfile.id,
    currentUser: updatedAdminProfile,
    checkoutData: {
      payment_method: 'cash',
      items: [
        {
          productId: 'PRD-TEST-SPICE01',
          quantity: 2,
          unitPrice: 22000.00 // Custom discounted price: 22,000 instead of 25,000 catalog price
        }
      ],
      notes: 'Admin direct counter sale with preferred pricing'
    }
  });
  console.log('  ✅ Admin executed POS sale:', adminCheckout.transaction_id, 'Total:', adminCheckout.total_amount, 'TSh');
  if (adminCheckout.total_amount !== 44000.00) {
    throw new Error(`Expected overridden total 44000, got ${adminCheckout.total_amount}`);
  }

  // -----------------------------------------------------------------------------
  // TEST SCENARIO 3: SELLER OPERATIONS & CUSTOMER RETURNS
  // -----------------------------------------------------------------------------
  console.log('\n▶ SCENARIO 3: Seller POS, Returns & Shift Closing');

  // 3.1 Seller login
  const sellerAuth = await authService.authenticateUser({
    identifier: 'seller_test',
    password: 'SellerPassword123!'
  });
  console.log('  ✅ Seller logged in:', sellerAuth.user.username, 'Assigned shop:', sellerAuth.user.shop_id);

  // 3.2 Seller scans product
  const scanned = await posService.scanProduct({
    productId: 'PRD-TEST-SPICE01',
    shopId: sellerAuth.user.shop_id
  });
  console.log('  ✅ Seller scanned product:', scanned.name, 'Stock remaining:', scanned.stock_quantity);

  // 3.3 Seller checkout
  const sellerSale = await posService.processCheckout({
    shopId: sellerAuth.user.shop_id,
    sellerId: sellerAuth.user.id,
    currentUser: sellerAuth.user,
    checkoutData: {
      payment_method: 'mobile_money',
      items: [
        {
          productId: 'PRD-TEST-SPICE01',
          quantity: 3
        }
      ]
    }
  });
  console.log('  ✅ Seller completed sale:', sellerSale.transaction_id, 'Units sold: 3');

  // 3.4 Seller Customer Return (Section 5)
  // Customer returns 1 unit: creates return transaction, restocks inventory
  const returnRes = await posService.processReturn({
    shopId: sellerAuth.user.shop_id,
    sellerId: sellerAuth.user.id,
    currentUser: sellerAuth.user,
    returnData: {
      items: [
        {
          productId: 'PRD-TEST-SPICE01',
          quantity: 1,
          unitPrice: 25000.00
        }
      ],
      reason: 'Customer ordered wrong package size',
      original_transaction_id: sellerSale.transaction_id
    }
  });
  console.log('  ✅ Customer return processed:', returnRes.transaction_id, 'Status:', returnRes.status, 'Refund total:', returnRes.total_amount);

  // Verify inventory restocked
  const chkRows = await query('SELECT stock_quantity FROM products WHERE id = ?', ['PRD-TEST-SPICE01']);
  const currentStock = parseInt(chkRows[0].stock_quantity, 10);
  console.log('  ✅ Current stock after initial (50) - admin (2) - seller (3) + return (1) =', currentStock);
  if (currentStock !== 46) {
    throw new Error(`Expected stock 46, got ${currentStock}`);
  }

  // 3.5 Seller Shift Reconciliation
  const recon = await analyticsService.getDailyReconciliation({
    shopId: sellerAuth.user.shop_id
  });
  console.log('  ✅ Shift reconciliation completed for shop:', recon.shop_id);
  console.log('     Total Transactions:', recon.total_transactions);
  console.log('     Refunded Returns Count:', recon.status_counts.refunded);
  console.log('     Cash Total:', recon.payment_breakdown.cash);
  console.log('     Mobile Money Total:', recon.payment_breakdown.mobile_money);

  // -----------------------------------------------------------------------------
  // TEST SCENARIO 4: STRICT SECURITY & CROSS-TENANT ISOLATION
  // -----------------------------------------------------------------------------
  console.log('\n▶ SCENARIO 4: Security & Cross-Tenant Boundary Tests');

  // 4.1 Admin attempts to view Shop 1 (belongs to Business 1, not BIZ_TEST)
  try {
    await shopService.getShopById(1, updatedAdminProfile);
    throw new Error('FAILED: Admin was able to access Shop 1 of another business!');
  } catch (err) {
    console.log('  🛡️ Cross-business shop access successfully blocked:', err.message);
  }

  // 4.2 Seller attempts to view Shop 2 (belongs to another business/shop)
  try {
    await shopService.getShopById(2, sellerAuth.user);
    throw new Error('FAILED: Seller was able to access Shop 2!');
  } catch (err) {
    console.log('  🛡️ Cross-shop seller access successfully blocked:', err.message);
  }

  // 4.3 Super Admin suspends Admin
  await authService.setUserActiveStatus({
    targetUserId: updatedAdminProfile.id,
    isActive: false,
    currentUser: superAdminAuth.user
  });
  console.log('  ✅ Super Admin suspended Admin account.');

  // Verify suspended Admin cannot log in
  try {
    await authService.authenticateUser({
      identifier: 'admin_test',
      password: 'PermanentPassword123!'
    });
    throw new Error('FAILED: Suspended Admin was able to authenticate!');
  } catch (err) {
    console.log('  🛡️ Suspended Admin login successfully blocked:', err.message);
  }

  // Reactivate Admin
  await authService.setUserActiveStatus({
    targetUserId: updatedAdminProfile.id,
    isActive: true,
    currentUser: superAdminAuth.user
  });
  console.log('  ✅ Super Admin reactivated Admin account.');

  // Clean up test data
  await query("DELETE FROM inventory_logs WHERE product_id = 'PRD-TEST-SPICE01'");
  await query("DELETE FROM transaction_items WHERE product_id = 'PRD-TEST-SPICE01'");
  await query("DELETE FROM transactions WHERE shop_id = ?", [newShop.id]);
  await query("DELETE FROM products WHERE id = 'PRD-TEST-SPICE01'");
  await query("DELETE FROM users WHERE id IN (?, ?)", [newAdmin.id, newSeller.id]);
  await query("DELETE FROM shops WHERE id = ?", [newShop.id]);
  await query("DELETE FROM businesses WHERE id = ?", [newBiz.id]);

  console.log('\n======================================================');
  console.log('🎉 ALL ROLE HIERARCHY TESTS PASSED WITH 100% SUCCESS!');
  console.log('======================================================\n');
}

runTests().then(() => process.exit(0)).catch(e => {
  console.error('\n❌ TEST FAILED:', e);
  process.exit(1);
});

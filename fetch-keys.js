/**
 * سكربت أتمتة جلب المفاتيح الجديدة
 * يمكن تشغيله محلياً أو عبر GitHub Actions
 * 
 * ملحوظة: هذا مثال بسيط. يجب تعديله حسب مصدر المفاتيح الخاص بك.
 */

const admin = require('firebase-admin');

async function initializeFirebase() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  return admin.firestore();
}

async function addKeyToFirestore(db, keyData) {
  const existing = await db.collection('api_keys')
    .where('key', '==', keyData.key)
    .limit(1)
    .get();

  if (!existing.empty) {
    console.log(`المفتاح موجود مسبقاً: ${keyData.key.substring(0, 8)}...`);
    return false;
  }

  await db.collection('api_keys').add({
    key: keyData.key,
    provider: keyData.provider,
    model: keyData.model || 'gpt-3.5-turbo',
    active: true,
    expiresAt: keyData.expiresAt || admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    ),
    lastUsed: admin.firestore.Timestamp.now(),
    useCount: 0,
    dailyLimit: keyData.dailyLimit || 100,
    createdAt: admin.firestore.Timestamp.now(),
    source: keyData.source || 'manual'
  });

  console.log(`تمت إضافة مفتاح جديد: ${keyData.provider} - ${keyData.model}`);
  return true;
}

async function deactivateExpiredKeys(db) {
  const now = admin.firestore.Timestamp.now();
  const snapshot = await db.collection('api_keys')
    .where('active', '==', true)
    .where('expiresAt', '<', now)
    .get();

  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.update(doc.ref, { active: false, deactivatedAt: now, reason: 'expired' });
  });

  await batch.commit();
  console.log(`تم تعطيل ${snapshot.size} مفتاح منتهي الصلاحية`);
}

async function main() {
  try {
    const db = await initializeFirebase();

    // 1. تعطيل المفاتيح المنتهية
    await deactivateExpiredKeys(db);

    // 2. هنا تضع منطق جلب المفاتيح الجديدة من مصادرك
    // مثال: جلب من ملف أو API خارجي

    // const newKeys = await fetchKeysFromYourSource();
    // for (const key of newKeys) {
    //   await addKeyToFirestore(db, key);
    // }

    console.log('اكتمل التحديث بنجاح');
    process.exit(0);

  } catch (error) {
    console.error('خطأ:', error);
    process.exit(1);
  }
}

// تشغيل إذا تم استدعاء الملف مباشرة
if (require.main === module) {
  main();
}

module.exports = { initializeFirebase, addKeyToFirestore, deactivateExpiredKeys };
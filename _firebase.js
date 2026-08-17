const admin = require('firebase-admin');

// التحقق مما إذا كان التطبيق مهيأً سابقاً لتجنب التهيأ المتعدد
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error('خطأ في تهيأ Firebase:', error.message);
    throw new Error('فشل في إعداد Firebase. تحقق من FIREBASE_SERVICE_ACCOUNT.');
  }
}

const db = admin.firestore();
module.exports = { db, admin };
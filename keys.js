const { db, admin } = require('./_firebase');

const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

module.exports = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // جلب قائمة المفاتيح (بدون إظهار المفتاح نفسه للأمان)
      const snapshot = await db.collection('api_keys').orderBy('lastUsed', 'desc').get();
      const keys = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          provider: data.provider,
          model: data.model,
          active: data.active,
          expiresAt: data.expiresAt?.toDate().toISString(),
          lastUsed: data.lastUsed?.toDate().toISString(),
          useCount: data.useCount || 0,
          maskedKey: data.key ? `${data.key.substring(0, 8)}...${data.key.substring(data.key.length - 4)}` : null
        };
      });
      return res.status(200).json({ keys });
    }

    if (req.method === 'POST') {
      // إضافة مفتاح جديد (للأدمين)
      const { key, provider, model, expiresAt, dailyLimit } = req.body;

      if (!key || !provider) {
        return res.status(400).json({ error: 'key و provider مطلوبان' });
      }

      const docRef = await db.collection('api_keys').add({
        key,
        provider,
        model: model || 'gpt-3.5-turbo',
        active: true,
        expiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(new Date(expiresAt)) : admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
        lastUsed: admin.firestore.Timestamp.now(),
        useCount: 0,
        dailyLimit: dailyLimit || 100,
        createdAt: admin.firestore.Timestamp.now()
      });

      return res.status(201).json({ 
        success: true, 
        id: docRef.id,
        message: 'تمت إضافة المفتاح بنجاح' 
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Error in /api/keys:', error);
    res.status(500).json({ error: error.message });
  }
};
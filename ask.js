const { db, admin } = require('./_firebase');

// إعدادات الـ CORS للسماح بتطبيق Android بالتصل
const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

// دالة مساعدة لإرسال طلب HTTP
const fetchExternalApi = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error ${response.status}: ${errorText}`);
  }
  return response.json();
};

module.exports = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { message, appId, model: requestedModel } = req.body;

    // التحقق من وجود البيانات الضرورية
    if (!message || !appId) {
      return res.status(400).json({ 
        error: 'البيانات ناقصة. يلزم: message, appId' 
      });
    }

    // 1. التحقق من الـ App ID والتطبيق المصرح
    const appDoc = await db.collection('allowed_apps').doc(appId).get();
    if (!appDoc.exists) {
      return res.status(403).json({ 
        error: 'تطبيق غير مصرح. تحقق من appId.' 
      });
    }

    const appData = appDoc.data();
    if (!appData.active) {
      return res.status(403).json({ 
        error: 'تطبيق معطل. اتصل بالمسؤول.' 
      });
    }

    // Rate limiting بسيط (التحقق من عدد الطلبات اليومية)
    const today = new Date().toISString().split('T')[0];
    const usageDoc = await db.collection('usage_logs').doc(`${appId}_${today}`).get();
    const dailyLimit = appData.dailyLimit || 100;
    const currentUsage = usageDoc.exists ? usageDoc.data().count : 0;

    if (currentUsage >= dailyLimit) {
      return res.status(429).json({ 
        error: 'تجاوز الحد اليومي للطلبات.' 
      });
    }

    // 2. جلب مفتاح نشط ومتاح
    const now = admin.firestore.Timestamp.now();
    const keysSnapshot = await db.collection('api_keys')
      .where('active', '==', true)
      .where('expiresAt', '>', now)
      .orderBy('lastUsed', 'asc')
      .limit(1)
      .get();

    if (keysSnapshot.empty) {
      return res.status(503).json({ 
        error: 'لا توجد مفاتيح AI نشطة متاحة حالياً. جرب لاحقاً.' 
      });
    }

    const keyDoc = keysSnapshot.docs[0];
    const keyData = keyDoc.data();

    // 3. إرسال الطلب لـ API المناسب حسب الـ provider
    let aiResponse;
    let replyText;
    const model = requestedModel || keyData.model || 'gpt-3.5-turbo';

    try {
      if (keyData.provider === 'openai') {
        aiResponse = await fetchExternalApi('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${keyData.key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: message }],
            temperature: 0.7,
            max_tokens: 2000
          })
        });
        replyText = aiResponse.choices?.[0]?.message?.content || 'لا توجد إجابة';

      } else if (keyData.provider === 'gemini') {
        aiResponse = await fetchExternalApi(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyData.key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: message }] }]
            })
          }
        );
        replyText = aiResponse.candidates?.[0]?.content?.parts?.[0]?.text || 'لا توجد إجابة';

      } else if (keyData.provider === 'groq') {
        aiResponse = await fetchExternalApi('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${keyData.key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: message }]
          })
        });
        replyText = aiResponse.choices?.[0]?.message?.content || 'لا توجد إجابة';

      } else {
        return res.status(400).json({ error: `Provider غير مدعوم: ${keyData.provider}` });
      }

    } catch (apiError) {
      // إذا فشل المفتاح (مثلاً انتهت صلاحيته)، عطله وإرجع خطأ
      if (apiError.message.includes('401') || apiError.message.includes('403')) {
        await keyDoc.ref.update({ active: false, errorAt: now, errorMessage: apiError.message });
        return res.status(503).json({ 
          error: 'المفتاح الحالي غير صالح. جرب مرة أخرى.' 
        });
      }
      throw apiError;
    }

    // 4. تحديث إحصائيات المفتاح
    await keyDoc.ref.update({
      lastUsed: now,
      useCount: admin.firestore.FieldValue.increment(1)
    });

    // 5. تسجيل الاستخدام للتطبيق
    if (usageDoc.exists) {
      await usageDoc.ref.update({ count: admin.firestore.FieldValue.increment(1) });
    } else {
      await db.collection('usage_logs').doc(`${appId}_${today}`).set({
        appId,
        date: today,
        count: 1,
        timestamp: now
      });
    }

    // 6. إرجاع الرد
    res.status(200).json({
      success: true,
      reply: replyText,
      model,
      provider: keyData.provider,
      timestamp: new Date().toISString()
    });

  } catch (error) {
    console.error('Error in /api/ask:', error);
    res.status(500).json({ 
      error: 'خطأ داخلي في الخادم.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
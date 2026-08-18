const supabase = require('./supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ═══ GET: حالة الخدمة ═══
  if (req.method === 'GET') {
    try {
      const { data: keys } = await supabase.from('api_keys').select('id, provider, model, active, use_count, last_used').eq('active', true);
      const { data: apps } = await supabase.from('allowed_apps').select('id, app_name, daily_limit, active').eq('active', true);
      return res.status(200).json({
        status: 'online',
        activeKeys: keys?.length || 0,
        registeredApps: apps?.length || 0,
        keys: keys || [],
        apps: apps || []
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ═══ POST: طلب تحليل ═══
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { appId, prompt } = req.body;
    if (!appId || !prompt) return res.status(400).json({ error: 'appId and prompt required' });

    const { data: app } = await supabase.from('allowed_apps').select('*').eq('id', appId).eq('active', true).single();
    if (!app) return res.status(403).json({ error: 'App not authorized' });

    const today = new Date().toISOString().split('T')[0];
    const { data: daily } = await supabase.from('daily_requests').select('count').eq('app_id', appId).eq('date', today).single();
    const currentCount = daily?.count || 0;

    if (currentCount >= app.daily_limit) {
      return res.status(429).json({ error: 'Daily limit exceeded', limit: app.daily_limit });
    }

    // ═══ جلب كل المفاتيح النشطة ═══
    const { data: allKeys } = await supabase
      .from('api_keys')
      .select('*')
      .eq('active', true)
      .order('use_count', { ascending: true });

    if (!allKeys || allKeys.length === 0) {
      return res.status(503).json({ error: 'No available keys' });
    }

    // ═══ محاولة كل مفتاح حتى يعمل واحد ═══
    let lastError = null;
    let usedKey = null;
    let aiResponse = null;

    for (const apiKey of allKeys) {
      if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
        await supabase.from('api_keys').update({ active: false }).eq('id', apiKey.id);
        continue;
      }

      try {
        aiResponse = await callAI(apiKey, prompt);
        usedKey = apiKey;
        break;
      } catch (e) {
        lastError = e.message;
        console.log('Key failed (' + apiKey.provider + '/' + apiKey.model + '): ' + e.message);
        continue;
      }
    }

    if (!aiResponse || !usedKey) {
      return res.status(503).json({
        error: 'All keys failed',
        lastError: lastError,
        tried: allKeys.length
      });
    }

    // ═══ تحديث العدادات ═══
    await supabase
      .from('api_keys')
      .update({ use_count: (usedKey.use_count || 0) + 1, last_used: new Date().toISOString() })
      .eq('id', usedKey.id);

    if (daily) {
      await supabase.from('daily_requests').update({ count: currentCount + 1 }).eq('app_id', appId).eq('date', today);
    } else {
      await supabase.from('daily_requests').insert({ app_id: appId, date: today, count: 1 });
    }

    return res.status(200).json({
      success: true,
      response: aiResponse,
      remaining: app.daily_limit - currentCount - 1,
      provider: usedKey.provider,
      model: usedKey.model,
      keysAvailable: allKeys.length
    });

  } catch (error) {
    console.error('Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

// ═══ استدعاء خدمات AI ═══
async function callAI(apiKey, prompt) {
  const headers = { 'Content-Type': 'application/json' };
  let url, body;

  // ─── Google Gemini ───
  if (apiKey.provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + apiKey.model + ':generateContent?key=' + apiKey.key;
    body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2000 }
    });
  }
  // ─── Cerebras ───
  else if (apiKey.provider === 'cerebras') {
    url = 'https://api.cerebras.ai/v1/chat/completions';
    headers['Authorization'] = 'Bearer ' + apiKey.key;
    body = JSON.stringify({
      model: apiKey.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.3
    });
  }
  // ─── SambaNova ───
  else if (apiKey.provider === 'sambanova') {
    url = 'https://api.sambanova.ai/v1/chat/completions';
    headers['Authorization'] = 'Bearer ' + apiKey.key;
    body = JSON.stringify({
      model: apiKey.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.3
    });
  }
  // ─── Hugging Face ───
  else if (apiKey.provider === 'huggingface') {
    url = 'https://api-inference.huggingface.co/models/' + apiKey.model;
    headers['Authorization'] = 'Bearer ' + apiKey.key;
    body = JSON.stringify({
      inputs: prompt,
      parameters: { max_new_tokens: 2000, temperature: 0.3 }
    });
  }
  // ─── المزودات المتوافقة مع OpenAI ───
  else {
    headers['Authorization'] = 'Bearer ' + apiKey.key;

    switch (apiKey.provider) {
      case 'groq':       url = 'https://api.groq.com/openai/v1/chat/completions'; break;
      case 'openrouter': url = 'https://openrouter.ai/api/v1/chat/completions'; break;
      case 'orcarouter': url = 'https://api.orcarouter.ai/v1/chat/completions'; break;
      case 'mistral':    url = 'https://api.mistral.ai/v1/chat/completions'; break;
      case 'openai':     url = 'https://api.openai.com/v1/chat/completions'; break;
      case 'custom':     url = (apiKey.model || '').replace(/\/$/, '') + '/v1/chat/completions'; break;
      default:
        throw new Error('Unknown provider: ' + apiKey.provider);
    }

    body = JSON.stringify({
      model: apiKey.provider === 'custom' ? undefined : apiKey.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.3,
      top_p: 0.9,
      frequency_penalty: 0.5,
      presence_penalty: 0.3
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('API error ' + response.status + ': ' + errText.slice(0, 200));
    }

    const data = await response.json();

    // OpenAI-compatible format
    if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
    // Gemini format
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) return data.candidates[0].content.parts[0].text;
    // Hugging Face format (text generation)
    if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
    // Hugging Face format (chat)
    if (data.choices?.[0]?.text) return data.choices[0].text;

    throw new Error('Unknown response format');
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

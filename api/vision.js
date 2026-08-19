const supabase = require('./supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { appId, prompt, image } = req.body;
    if (!appId || !prompt || !image) {
      return res.status(400).json({ error: 'appId, prompt, and image required' });
    }

    // Check app authorization
    const { data: app } = await supabase
      .from('allowed_apps')
      .select('*')
      .eq('id', appId)
      .eq('active', true)
      .single();

    if (!app) return res.status(403).json({ error: 'App not authorized' });

    // Daily limit check
    const today = new Date().toISOString().split('T')[0];
    const { data: daily } = await supabase
      .from('daily_requests')
      .select('count')
      .eq('app_id', appId)
      .eq('date', today)
      .single();

    const currentCount = daily?.count || 0;
    if (currentCount >= app.daily_limit) {
      return res.status(429).json({ error: 'Daily limit exceeded' });
    }

    // Find vision-capable keys
    const visionProviders = ['openai', 'openrouter', 'custom'];
    const { data: allKeys } = await supabase
      .from('api_keys')
      .select('*')
      .eq('active', true)
      .order('use_count', { ascending: true });

    const visionKeys = (allKeys || []).filter(k =>
      visionProviders.includes(k.provider) &&
      (!k.expires_at || new Date(k.expires_at) > new Date())
    );

    if (visionKeys.length === 0) {
      return res.status(503).json({
        error: 'No vision-capable keys available. Add OpenAI, OpenRouter, or Custom (with vision model) key.'
      });
    }

    // Try each key
    let lastError = null;
    for (const apiKey of visionKeys) {
      try {
        const result = await callVision(apiKey, prompt, image);

        // Update usage
        await supabase
          .from('api_keys')
          .update({ use_count: (apiKey.use_count || 0) + 1, last_used: new Date().toISOString() })
          .eq('id', apiKey.id);

        // Update daily count
        if (daily) {
          await supabase.from('daily_requests').update({ count: currentCount + 1 }).eq('app_id', appId).eq('date', today);
        } else {
          await supabase.from('daily_requests').insert({ app_id: appId, date: today, count: 1 });
        }

        return res.status(200).json({
          success: true,
          response: result,
          provider: apiKey.provider,
          model: apiKey.model
        });
      } catch (e) {
        lastError = e.message;
        console.log('Vision key failed (' + apiKey.provider + '): ' + e.message);
        continue;
      }
    }

    return res.status(503).json({ error: 'All vision keys failed', lastError });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

async function callVision(apiKey, prompt, imageUrl) {
  const headers = { 'Content-Type': 'application/json' };
  let url;

  switch (apiKey.provider) {
    case 'openai':
      url = 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = 'Bearer ' + apiKey.key;
      break;
    case 'openrouter':
      url = 'https://openrouter.ai/api/v1/chat/completions';
      headers['Authorization'] = 'Bearer ' + apiKey.key;
      break;
    case 'custom':
      if (apiKey.base_url) {
        url = apiKey.base_url.replace(/\/$/, '') + '/v1/chat/completions';
      } else {
        throw new Error('Custom vision key requires base_url');
      }
      headers['Authorization'] = 'Bearer ' + apiKey.key;
      break;
    default:
      throw new Error('Provider ' + apiKey.provider + ' does not support vision');
  }

  const body = JSON.stringify({
    model: apiKey.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
      ]
    }],
    max_tokens: 2000,
    temperature: 0.3
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('API ' + response.status + ': ' + errText.slice(0, 300));
    }

    const data = await response.json();
    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }

    throw new Error('Unknown vision response format');
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

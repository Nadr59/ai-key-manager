const supabase = require('./supabase');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { appId, prompt } = req.body;
    if (!appId || !prompt) return res.status(400).json({ error: 'appId and prompt required' });
    const { data: app } = await supabase.from('allowed_apps').select('*').eq('id', appId).eq('active', true).single();
    if (!app) return res.status(403).json({ error: 'App not authorized' });
    const today = new Date().toISOString().split('T')[0];
    const { data: daily } = await supabase.from('daily_requests').select('count').eq('app_id', appId).eq('date', today).single();
    const currentCount = daily?.count || 0;
    if (currentCount >= app.daily_limit) return res.status(429).json({ error: 'Daily limit exceeded', limit: app.daily_limit });
    const { data: keys } = await supabase.from('api_keys').select('*').eq('active', true).order('use_count', { ascending: true }).limit(1);
    if (!keys || keys.length === 0) return res.status(503).json({ error: 'No available keys' });
    const apiKey = keys[0];
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      await supabase.from('api_keys').update({ active: false }).eq('id', apiKey.id);
      return res.status(503).json({ error: 'Key expired' });
    }
    const aiResponse = await callAI(apiKey, prompt);
    await supabase.from('api_keys').update({ use_count: (apiKey.use_count || 0) + 1, last_used: new Date().toISOString() }).eq('id', apiKey.id);
    if (daily) {
      await supabase.from('daily_requests').update({ count: currentCount + 1 }).eq('app_id', appId).eq('date', today);
    } else {
      await supabase.from('daily_requests').insert({ app_id: appId, date: today, count: 1 });
    }
    return res.status(200).json({ success: true, response: aiResponse, remaining: app.daily_limit - currentCount - 1, provider: apiKey.provider });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

async function callAI(apiKey, prompt) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey.key };
  let url, body;

  if (apiKey.provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + apiKey.model + ':generateContent?key=' + apiKey.key;
    body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
  } else {
    switch (apiKey.provider) {
      case 'groq':       url = 'https://api.groq.com/openai/v1/chat/completions'; break;
      case 'openrouter': url = 'https://openrouter.ai/api/v1/chat/completions'; break;
      case 'orcarouter': url = 'https://api.orcarouter.ai/v1/chat/completions'; break;
      case 'mistral':    url = 'https://api.mistral.ai/v1/chat/completions'; break;
      case 'openai':     url = 'https://api.openai.com/v1/chat/completions'; break;
      default:
        throw new Error('Unknown provider: ' + apiKey.provider);
    }
    body = JSON.stringify({ model: apiKey.model, messages: [{ role: 'user', content: prompt }], max_tokens: 1000 });
  }

  const response = await fetch(url, { method: 'POST', headers, body });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error('AI API error ' + response.status + ': ' + errText.slice(0, 200));
  }

  const data = await response.json();
  if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
  if (data.candidates?.[0]?.content?.parts?.[0]?.text) return data.candidates[0].content.parts[0].text;
  throw new Error('Unknown response format');
}

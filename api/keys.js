const supabase = require('./supabase');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('api_keys').select('id, provider, model, active, use_count, last_used, expires_at').order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ keys: data });
    }
    if (req.method === 'POST') {
      const { key, provider, model, expiresAt } = req.body;
      if (!key || !provider) return res.status(400).json({ error: 'key and provider required' });
      const { data, error } = await supabase.from('api_keys').insert({ key, provider, model: model || 'gpt-3.5-turbo', expires_at: expiresAt || null }).select().single();
      if (error) throw error;
      return res.status(201).json({ success: true, id: data.id });
    }
    if (req.method === 'DELETE') {
      const { id } = req.query;
      const { error } = await supabase.from('api_keys').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

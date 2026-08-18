const supabase = require('./supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // ═══ GET: لوحة معلومات كاملة ═══
    if (req.method === 'GET') {
      const [keysResult, appsResult, requestsResult] = await Promise.all([
        supabase.from('api_keys').select('id, provider, model, active, use_count, last_used, expires_at, created_at').order('created_at', { ascending: false }),
        supabase.from('allowed_apps').select('*').order('created_at', { ascending: false }),
        supabase.from('daily_requests').select('*').order('date', { ascending: false }).limit(100)
      ]);

      const totalRequests = requestsResult.data?.reduce((sum, r) => sum + r.count, 0) || 0;
      const todayRequests = requestsResult.data?.filter(r => r.date === new Date().toISOString().split('T')[0]).reduce((sum, r) => sum + r.count, 0) || 0;

      return res.status(200).json({
        keys: keysResult.data || [],
        apps: appsResult.data || [],
        stats: {
          totalKeys: keysResult.data?.length || 0,
          activeKeys: keysResult.data?.filter(k => k.active).length || 0,
          totalApps: appsResult.data?.length || 0,
          totalRequests: totalRequests,
          todayRequests: todayRequests
        },
        recentRequests: requestsResult.data?.slice(0, 20) || []
      });
    }

    // ═══ POST: إضافة مفتاح ═══
    if (req.method === 'POST') {
      const { action, key, provider, model, expiresAt, id, active, appName, appId, dailyLimit } = req.body;

      // إضافة مفتاح
      if (action === 'add_key' || (!action && key)) {
        if (!key || !provider) return res.status(400).json({ error: 'key and provider required' });
        const { data, error } = await supabase.from('api_keys').insert({
          key, provider, model: model || 'auto', expires_at: expiresAt || null
        }).select().single();
        if (error) throw error;
        return res.status(201).json({ success: true, id: data.id });
      }

      // تحديث مفتاح
      if (action === 'update_key') {
        if (!id) return res.status(400).json({ error: 'id required' });
        const updates = {};
        if (key !== undefined) updates.key = key;
        if (provider !== undefined) updates.provider = provider;
        if (model !== undefined) updates.model = model;
        if (active !== undefined) updates.active = active;
        if (expiresAt !== undefined) updates.expires_at = expiresAt;
        const { error } = await supabase.from('api_keys').update(updates).eq('id', id);
        if (error) throw error;
        return res.status(200).json({ success: true });
      }

      // حذف مفتاح
      if (action === 'delete_key') {
        if (!id) return res.status(400).json({ error: 'id required' });
        const { error } = await supabase.from('api_keys').delete().eq('id', id);
        if (error) throw error;
        return res.status(200).json({ success: true });
      }

      // إضافة تطبيق
      if (action === 'add_app') {
        if (!appId || !appName) return res.status(400).json({ error: 'appId and appName required' });
        const { data, error } = await supabase.from('allowed_apps').insert({
          id: appId, app_name: appName, daily_limit: dailyLimit || 100
        }).select().single();
        if (error) throw error;
        return res.status(201).json({ success: true, id: data.id });
      }

      // تحديث تطبيق
      if (action === 'update_app') {
        if (!appId) return res.status(400).json({ error: 'appId required' });
        const updates = {};
        if (appName !== undefined) updates.app_name = appName;
        if (dailyLimit !== undefined) updates.daily_limit = dailyLimit;
        if (active !== undefined) updates.active = active;
        const { error } = await supabase.from('allowed_apps').update(updates).eq('id', appId);
        if (error) throw error;
        return res.status(200).json({ success: true });
      }

      // حذف تطبيق
      if (action === 'delete_app') {
        if (!appId) return res.status(400).json({ error: 'appId required' });
        const { error } = await supabase.from('allowed_apps').delete().eq('id', appId);
        if (error) throw error;
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

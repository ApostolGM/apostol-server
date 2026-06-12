// server/server/routes/sounds.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { data } = await supabase
    .from('sounds')
    .select('*')
    .or(`campaign_id.eq.${req.params.campaign_id},is_global.eq.true`)
    .order('name', { ascending: true });
  res.json(data || []);
});

router.post('/', authMiddleware, async (req, res) => {
  const { campaign_id, name, file_url, source_type, duration, category } = req.body;
  const { data, error } = await supabase
    .from('sounds')
    .insert({
      campaign_id,
      name,
      file_url,
      source_type: source_type || 'url',
      duration: duration || 0,
      category: category || 'общее',
      is_global: false,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', authMiddleware, async (req, res) => {
  await supabase.from('sounds').delete().eq('id', req.params.id);
  res.json({ success: true });
});

export default router;

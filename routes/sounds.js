// routes/sounds.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware.js';

const router = Router();

// GET /api/sounds/:campaign_id
router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('sounds')
    .select('*').or(`campaign_id.eq.${req.params.campaign_id},is_global.eq.true`)
    .order('name');
  res.json(data || []);
});

// POST /api/sounds
router.post('/', authMiddleware, async (req, res) => {
  const { campaign_id, name, file_url, source_type, duration, category, is_global } = req.body;
  const { data, error } = await supabase.from('sounds').insert({
    campaign_id: is_global ? null : campaign_id, name, file_url,
    source_type: source_type || 'url', duration: duration || 0,
    category: category || 'общее', is_global: is_global || false
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/sounds/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  await supabase.from('sounds').delete().eq('id', req.params.id);
  res.json({ success: true });
});

export default router;

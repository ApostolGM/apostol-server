// routes/scenes.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, validate, schemas } from '../middleware.js';

const router = Router();

// GET /api/scenes/:campaign_id
router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { type } = req.query;
  const query = supabase.from('scenes').select('*').eq('campaign_id', req.params.campaign_id);
  if (type) query.eq('scene_type', type);
  const { data } = await query;
  res.json(data || []);
});

// PUT /api/scenes/:campaign_id
router.put('/:campaign_id', authMiddleware, validate(schemas.updateScene), async (req, res) => {
  const { scene_type, background_url, tokens, drawings, portals } = req.body;
  const { data: existing } = await supabase.from('scenes')
    .select('id').eq('campaign_id', req.params.campaign_id).eq('scene_type', scene_type).single();

  if (existing) {
    const updates = {};
    if (background_url !== undefined) updates.background_url = background_url;
    if (tokens !== undefined) updates.tokens = tokens;
    if (drawings !== undefined) updates.drawings = drawings;
    if (portals !== undefined) updates.portals = portals;

    const { data, error } = await supabase.from('scenes')
      .update(updates).eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } else {
    const { data, error } = await supabase.from('scenes').insert({
      campaign_id: req.params.campaign_id, scene_type,
      background_url: background_url || null,
      tokens: tokens || [],
      drawings: drawings || [],
      portals: portals || []
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
});

export default router;

// routes/scenes.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';

const router = Router();

router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { type } = req.query;
  const query = supabase
    .from('scenes')
    .select('*')
    .eq('campaign_id', req.params.campaign_id);
  if (type) query.eq('scene_type', type);
  const { data } = await query;
  res.json(data || []);
});

router.put('/:campaign_id', authMiddleware, validate(schemas.updateScene), async (req, res) => {
  const { scene_type, background_url, fog_of_war, tokens, drawings, portals } = req.body;

  const { data: existing } = await supabase
    .from('scenes')
    .select('id')
    .eq('campaign_id', req.params.campaign_id)
    .eq('scene_type', scene_type)
    .single();

  if (existing) {
    const updates = {};
    if (background_url !== undefined) updates.background_url = background_url;
    if (fog_of_war !== undefined) updates.fog_of_war = fog_of_war;
    if (tokens !== undefined) updates.tokens = tokens;
    if (drawings !== undefined) updates.drawings = drawings;
    if (portals !== undefined) updates.portals = portals;
    const { data, error } = await supabase
      .from('scenes')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } else {
    const { data, error } = await supabase
      .from('scenes')
      .insert({
        campaign_id: req.params.campaign_id,
        scene_type,
        background_url: background_url || null,
        fog_of_war: fog_of_war || [],
        tokens: tokens || [],
        drawings: drawings || [],
        portals: portals || [],
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
});

export default router;

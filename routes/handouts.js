// routes/handouts.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// GET /api/handouts/:campaign_id
router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('handouts')
    .select('*').eq('campaign_id', req.params.campaign_id)
    .order('created_at', { ascending: false });
  res.json(data || []);
});

// POST /api/handouts
router.post('/', authMiddleware, async (req, res) => {
  const { campaign_id, title, content, image_url, category, is_visible } = req.body;
  const { data, error } = await supabase.from('handouts').insert({
    campaign_id, title, content: content || '', image_url,
    category: category || 'общее', is_visible: is_visible !== undefined ? is_visible : false
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  if (data?.campaign_id) notifyCampaign(data.campaign_id, 'handouts_updated', { campaign_id: data.campaign_id });
  res.json(data);
});

// PUT /api/handouts/:id
router.put('/:id', authMiddleware, async (req, res) => {
  const { title, content, image_url, category, is_visible } = req.body;
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (image_url !== undefined) updates.image_url = image_url;
  if (category !== undefined) updates.category = category;
  if (is_visible !== undefined) updates.is_visible = is_visible;

  const { data, error } = await supabase.from('handouts')
    .update(updates).eq('id', req.params.id).select().single();

  if (error) return res.status(500).json({ error: error.message });
  if (data?.campaign_id) notifyCampaign(data.campaign_id, 'handouts_updated', { campaign_id: data.campaign_id });
  res.json(data);
});

// DELETE /api/handouts/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  const { data: h } = await supabase.from('handouts').select('campaign_id').eq('id', req.params.id).single();
  await supabase.from('handouts').delete().eq('id', req.params.id);
  if (h?.campaign_id) notifyCampaign(h.campaign_id, 'handouts_updated', { campaign_id: h.campaign_id });
  res.json({ success: true });
});

export default router;

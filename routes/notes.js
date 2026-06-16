// routes/notes.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// GET /api/notes/:campaign_id
router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('master_notes')
    .select('*').eq('campaign_id', req.params.campaign_id)
    .order('order_index').order('created_at', { ascending: false });
  res.json(data || []);
});

// POST /api/notes
router.post('/', authMiddleware, async (req, res) => {
  const { campaign_id, parent_id, title, content, image_url, tags, world, region, city, location, is_pinned } = req.body;
  const { data, error } = await supabase.from('master_notes').insert({
    campaign_id, parent_id: parent_id || null, title, content: content || '',
    image_url, tags: tags || [], world, region, city, location, is_pinned: is_pinned || false
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  if (campaign_id) notifyCampaign(campaign_id, 'notes_updated', { campaign_id });
  res.json(data);
});

// PUT /api/notes/:id
router.put('/:id', authMiddleware, async (req, res) => {
  const { title, content, image_url, tags, world, region, city, location, is_pinned, parent_id } = req.body;
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (image_url !== undefined) updates.image_url = image_url;
  if (tags !== undefined) updates.tags = tags;
  if (world !== undefined) updates.world = world;
  if (region !== undefined) updates.region = region;
  if (city !== undefined) updates.city = city;
  if (location !== undefined) updates.location = location;
  if (is_pinned !== undefined) updates.is_pinned = is_pinned;
  if (parent_id !== undefined) updates.parent_id = parent_id;
  updates.updated_at = new Date();

  const { data, error } = await supabase.from('master_notes')
    .update(updates).eq('id', req.params.id).select().single();

  if (error) return res.status(500).json({ error: error.message });
  if (data?.campaign_id) notifyCampaign(data.campaign_id, 'notes_updated', { campaign_id: data.campaign_id });
  res.json(data);
});

// DELETE /api/notes/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  const { data: note } = await supabase.from('master_notes').select('campaign_id').eq('id', req.params.id).single();
  await supabase.from('master_notes').delete().eq('id', req.params.id);
  if (note?.campaign_id) notifyCampaign(note.campaign_id, 'notes_updated', { campaign_id: note.campaign_id });
  res.json({ success: true });
});

export default router;

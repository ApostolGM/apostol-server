// server/server/routes/notes.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { data } = await supabase
    .from('master_notes')
    .select('*')
    .eq('campaign_id', req.params.campaign_id)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: false });
  res.json(data || []);
});

router.post('/', authMiddleware, async (req, res) => {
  const { campaign_id, parent_id, title, content, image_url, tags, world, region, city, location, is_pinned } = req.body;
  const { data, error } = await supabase
    .from('master_notes')
    .insert({
      campaign_id,
      parent_id: parent_id || null,
      title,
      content: content || '',
      image_url,
      tags: tags || [],
      world,
      region,
      city,
      location,
      is_pinned: is_pinned || false,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

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

  const { data, error } = await supabase
    .from('master_notes')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', authMiddleware, async (req, res) => {
  await supabase.from('master_notes').delete().eq('id', req.params.id);
  res.json({ success: true });
});

export default router;

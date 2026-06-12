// server/server/routes/handouts.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { data } = await supabase
    .from('handouts')
    .select('*')
    .eq('campaign_id', req.params.campaign_id)
    .order('created_at', { ascending: false });
  res.json(data || []);
});

router.post('/', authMiddleware, async (req, res) => {
  const { campaign_id, title, content, image_url, category, is_visible } = req.body;
  const { data, error } = await supabase
    .from('handouts')
    .insert({
      campaign_id,
      title,
      content: content || '',
      image_url,
      category: category || 'общее',
      is_visible: is_visible !== undefined ? is_visible : false,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/:id', authMiddleware, async (req, res) => {
  const { title, content, image_url, category, is_visible } = req.body;
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (image_url !== undefined) updates.image_url = image_url;
  if (category !== undefined) updates.category = category;
  if (is_visible !== undefined) updates.is_visible = is_visible;

  const { data, error } = await supabase
    .from('handouts')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', authMiddleware, async (req, res) => {
  await supabase.from('handouts').delete().eq('id', req.params.id);
  res.json({ success: true });
});

export default router;

// routes/admin.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';

const router = Router();

router.get('/items', authMiddleware, adminMiddleware, async (req, res) => {
  const { data } = await supabase.from('items').select('*').order('name');
  res.json(data || []);
});
router.put('/items/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('items')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
router.delete('/items/:id', authMiddleware, adminMiddleware, async (req, res) => {
  await supabase.from('items').delete().eq('id', req.params.id);
  res.json({ success: true });
});

router.get('/perks', authMiddleware, adminMiddleware, async (req, res) => {
  const { data } = await supabase.from('perks').select('*').order('name');
  res.json(data || []);
});
router.put('/perks/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('perks')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/professions', authMiddleware, adminMiddleware, async (req, res) => {
  const { data } = await supabase.from('professions').select('*').order('name');
  res.json(data || []);
});
router.put('/professions/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('professions')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/skills', authMiddleware, adminMiddleware, async (req, res) => {
  const { data } = await supabase.from('skills').select('*').order('name');
  res.json(data || []);
});
router.put('/skills/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('skills')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;

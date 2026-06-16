// routes/characteristics.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, adminMiddleware } from '../middleware.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('characteristics').select('*').order('name');
  res.json(data || []);
});

router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, short_name, description } = req.body;
  const { data, error } = await supabase.from('characteristics')
    .insert({ name, short_name, description }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('characteristics')
    .update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  await supabase.from('characteristics').delete().eq('id', req.params.id);
  res.json({ success: true });
});

export default router;

// routes/currencies.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, adminMiddleware } from '../middleware.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('currencies').select('*').order('name');
  res.json(data || []);
});

router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, icon } = req.body;
  const { data, error } = await supabase.from('currencies').insert({ name, icon }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  await supabase.from('currencies').delete().eq('id', req.params.id);
  res.json({ success: true });
});

export default router;

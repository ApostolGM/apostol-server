// server/server/routes/items.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('items').select('*');
  res.json(data);
});

router.post('/', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('items')
    .insert(req.body)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;

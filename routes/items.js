// routes/items.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, validate, schemas } from '../middleware.js';

const router = Router();

// GET /api/items
router.get('/', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('items').select('*, ammo_type:ammo_types(*)').order('name');
  res.json(data);
});

// POST /api/items
router.post('/', authMiddleware, validate(schemas.createItem), async (req, res) => {
  const { data, error } = await supabase.from('items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;

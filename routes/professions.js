// routes/professions.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware.js';

const router = Router();

// GET /api/professions
router.get('/', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('professions').select('*').order('name');
  res.json(data || []);
});

export default router;

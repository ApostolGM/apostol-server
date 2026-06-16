// routes/professions.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware.js';

const router = Router();

// GET /api/professions
router.get('/', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('professions').select('*').order('name');
  res.json(data);
});

// GET /api/perks
router.get('/perks', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('perks').select('*').order('name');
  res.json(data);
});

// GET /api/skills
router.get('/skills', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('skills').select('*, characteristic:characteristics(*)').order('name');
  res.json(data);
});

export default router;

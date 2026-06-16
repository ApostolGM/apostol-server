// routes/backgrounds.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware.js';

const router = Router();

router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('backgrounds')
    .select('*').or(`campaign_id.eq.${req.params.campaign_id},is_global.eq.true`).order('name');
  res.json(data || []);
});

export default router;

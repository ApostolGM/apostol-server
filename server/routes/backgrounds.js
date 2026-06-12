// routes/backgrounds.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/', authMiddleware, async (req, res) => {
  const { campaign_id, name, url } = req.body;
  if (!campaign_id || !url) {
    return res.status(400).json({ error: 'campaign_id и url обязательны' });
  }
  const { data, error } = await supabase
    .from('backgrounds')
    .insert({ campaign_id, name, url })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { data } = await supabase
    .from('backgrounds')
    .select('*')
    .eq('campaign_id', req.params.campaign_id);
  res.json(data || []);
});

export default router;

// routes/chat.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, chatLimiter, validate, schemas } from '../middleware.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// GET /api/chat/:campaign_id
router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('chat_messages')
    .select('*').eq('campaign_id', req.params.campaign_id)
    .order('created_at', { ascending: false }).limit(60);
  res.json((data || []).reverse());
});

// POST /api/chat/:campaign_id
router.post('/:campaign_id', authMiddleware, chatLimiter, validate(schemas.sendMessage), async (req, res) => {
  const { text, is_roll } = req.body;
  const { data, error } = await supabase.from('chat_messages').insert({
    campaign_id: req.params.campaign_id, user_id: req.user.id,
    username: req.user.username, text, is_roll: is_roll || false
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  notifyCampaign(req.params.campaign_id, 'chat_message', data);
  res.json(data);
});

export default router;

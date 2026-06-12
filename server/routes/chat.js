// server/server/routes/chat.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';
import { chatLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/:campaign_id', authMiddleware, async (req, res) => {
  const { data } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('campaign_id', req.params.campaign_id)
    .order('created_at', { ascending: false })
    .limit(60);
  res.json((data || []).reverse());
});

router.post('/:campaign_id', authMiddleware, chatLimiter, validate(schemas.sendMessage), async (req, res) => {
  const { text, is_roll } = req.body;
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      campaign_id: req.params.campaign_id,
      user_id: req.user.id,
      username: req.user.username,
      text,
      is_roll: is_roll || false,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  req.app.get('io').to(`campaign:${req.params.campaign_id}`).emit('chat_message', data);
  res.json(data);
});

export default router;

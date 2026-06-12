// server/server/routes/campaigns.js
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';
import { validate, schemas } from '../middleware/validate.js';

const router = Router();

router.post('/', authMiddleware, adminMiddleware, validate(schemas.createCampaign), async (req, res) => {
  const { title } = req.body;
  const invite_code = uuidv4().substring(0, 8);
  const { data: c, error } = await supabase
    .from('campaigns')
    .insert({ title, master_id: req.user.id, invite_code })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  await Promise.all([
    supabase.from('campaign_members').insert({
      campaign_id: c.id, user_id: req.user.id, role: 'master'
    }),
    supabase.from('scenes').insert({ campaign_id: c.id, scene_type: 'local' }),
    supabase.from('scenes').insert({ campaign_id: c.id, scene_type: 'global' }),
  ]);
  res.json(c);
});

router.post('/join/:code', authMiddleware, async (req, res) => {
  const { data: c } = await supabase
    .from('campaigns')
    .select('*')
    .eq('invite_code', req.params.code)
    .single();
  if (!c) return res.status(404).json({ error: 'Кампания не найдена' });

  const { data: ex } = await supabase
    .from('campaign_members')
    .select('id')
    .eq('campaign_id', c.id)
    .eq('user_id', req.user.id)
    .single();
  if (ex) return res.status(409).json({ error: 'Вы уже в кампании' });

  await supabase.from('campaign_members').insert({
    campaign_id: c.id, user_id: req.user.id, role: 'player'
  });
  res.json(c);
});

router.get('/', authMiddleware, async (req, res) => {
  const { data: m } = await supabase
    .from('campaign_members')
    .select('campaign_id')
    .eq('user_id', req.user.id);
  if (!m?.length) return res.json([]);
  const { data } = await supabase
    .from('campaigns')
    .select('*')
    .in('id', m.map(x => x.campaign_id));
  res.json(data);
});

router.get('/:id', authMiddleware, async (req, res) => {
  const { data: c } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (!c) return res.status(404).json({ error: 'Кампания не найдена' });

  const { data: members } = await supabase
    .from('campaign_members')
    .select('user_id, role, character_id, user:users(username)')
    .eq('campaign_id', c.id);
  res.json({ ...c, members });
});

router.put('/:id/time', authMiddleware, async (req, res) => {
  const { game_time_date, game_time_hours, game_time_minutes } = req.body;
  const updates = {};
  if (game_time_date !== undefined) updates.game_time_date = game_time_date;
  if (game_time_hours !== undefined) updates.game_time_hours = game_time_hours;
  if (game_time_minutes !== undefined) updates.game_time_minutes = game_time_minutes;

  const { data, error } = await supabase
    .from('campaigns')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;

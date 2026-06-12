// routes/characters.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';
import { enrichCharacter } from '../utils/characterEnricher.js';

const router = Router();

router.get('/campaigns/:id/characters', authMiddleware, async (req, res) => {
  const { data: member } = await supabase
    .from('campaign_members')
    .select('role')
    .eq('campaign_id', req.params.id)
    .eq('user_id', req.user.id)
    .single();
  if (!member || !['master', 'co-master'].includes(member.role)) {
    return res.status(403).json({ error: 'Только для Мастера' });
  }

  const { data: members } = await supabase
    .from('campaign_members')
    .select('user_id, role, character_id')
    .eq('campaign_id', req.params.id)
    .eq('role', 'player')
    .not('character_id', 'is', null);

  if (!members?.length) return res.json([]);

  const charIds = members.map(m => m.character_id);
  const { data: chars } = await supabase
    .from('characters')
    .select('*')
    .in('id', charIds);

  if (!chars?.length) return res.json([]);

  const enriched = await enrichCharacter(chars);
  const enrichedWithOwner = enriched.map(ch => {
    const owner = members.find(m => m.character_id === ch.id);
    return { ...ch, owner_role: owner?.role, owner_id: owner?.user_id };
  });

  res.json(enrichedWithOwner);
});

router.post('/', authMiddleware, validate(schemas.createCharacter), async (req, res) => {
  const { campaign_id, name, profession_id, perk_ids } = req.body;

  const { data: member } = await supabase
    .from('campaign_members')
    .select('role')
    .eq('campaign_id', campaign_id)
    .eq('user_id', req.user.id)
    .single();
  if (!member || ['master', 'co-master'].includes(member.role)) {
    return res.status(403).json({ error: 'Мастер не может создавать персонажа' });
  }

  const { data: prof } = await supabase
    .from('professions')
    .select('*')
    .eq('id', profession_id)
    .single();
  if (!prof) return res.status(400).json({ error: 'Профессия не найдена' });

  let bp = 10;
  if (perk_ids?.length) {
    const { data: perks } = await supabase
      .from('perks')
      .select('*')
      .in('id', perk_ids);
    for (const p of perks) bp += p.cost;
  }
  if (bp < 0) return res.status(400).json({ error: `Не хватает очков: ${bp}` });

  const { data: ch, error } = await supabase
    .from('characters')
    .insert({
      user_id: req.user.id,
      campaign_id,
      name,
      profession_id,
      balance_points: bp,
      food: 100,
      water: 100,
      stress: 0,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  const insertPromises = [];
  for (const ss of (prof.starter_skills || [])) {
    const { data: sk } = await supabase
      .from('skills')
      .select('id')
      .eq('name', ss.skill)
      .single();
    if (sk) {
      insertPromises.push(
        supabase.from('character_skills').insert({
          character_id: ch.id,
          skill_id: sk.id,
          modifier: ss.modifier,
        })
      );
    }
  }
  if (perk_ids?.length) {
    for (const pid of perk_ids) {
      insertPromises.push(
        supabase.from('character_perks').insert({
          character_id: ch.id,
          perk_id: pid,
        })
      );
    }
  }
  insertPromises.push(
    supabase.from('campaign_members')
      .update({ character_id: ch.id })
      .eq('campaign_id', campaign_id)
      .eq('user_id', req.user.id)
  );

  await Promise.all(insertPromises);

  const enriched = await enrichCharacter(ch);
  res.json(enriched);
});

router.get('/:id', authMiddleware, async (req, res) => {
  const { data: ch } = await supabase
    .from('characters')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (!ch) return res.status(404).json({ error: 'Персонаж не найден' });

  const enriched = await enrichCharacter(ch);
  res.json(enriched);
});

router.put('/:id/params', authMiddleware, async (req, res) => {
  const allowed = [
    'food', 'water', 'stress', 'game_time_date',
    'game_time_hours', 'game_time_minutes', 'carry_weight_max'
  ];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }

  const { data, error } = await supabase
    .from('characters')
    .update(updates)
    .eq('id', req.params.id)
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  if (data?.campaign_id) {
    req.app.get('io')
      .to(`campaign:${data.campaign_id}`)
      .emit('character_updated', { character_id: req.params.id, updates });
  }
  res.json(data);
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const { data: ch } = await supabase
    .from('characters')
    .select('campaign_id, user_id')
    .eq('id', req.params.id)
    .single();
  if (!ch) return res.status(404).json({ error: 'Персонаж не найден' });

  const { data: member } = await supabase
    .from('campaign_members')
    .select('role')
    .eq('campaign_id', ch.campaign_id)
    .eq('user_id', req.user.id)
    .single();
  if (!member || !['master', 'co-master'].includes(member.role)) {
    return res.status(403).json({ error: 'Только для Мастера' });
  }

  await Promise.all([
    supabase.from('campaign_members')
      .update({ character_id: null })
      .eq('character_id', req.params.id),
    supabase.from('inventory_slots').delete().eq('character_id', req.params.id),
    supabase.from('character_skills').delete().eq('character_id', req.params.id),
    supabase.from('character_perks').delete().eq('character_id', req.params.id),
    supabase.from('characters').delete().eq('id', req.params.id),
  ]);
  res.json({ success: true });
});

export default router;

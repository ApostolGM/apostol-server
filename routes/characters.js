// routes/characters.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, validate, schemas } from '../middleware.js';
import { enrichCharacter } from '../enrichCharacter.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// POST /api/characters — создать персонажа
router.post('/', authMiddleware, validate(schemas.createCharacter), async (req, res) => {
  const { campaign_id, name, profession_id, perk_ids, perk_data } = req.body;

  const { data: member } = await supabase.from('campaign_members')
    .select('role').eq('campaign_id', campaign_id).eq('user_id', req.user.id).single();
  if (!member || ['master', 'co-master'].includes(member.role)) {
    return res.status(403).json({ error: 'Мастер не может создавать персонажа' });
  }

  const { data: prof } = await supabase.from('professions').select('*').eq('id', profession_id).single();
  if (!prof) return res.status(400).json({ error: 'Профессия не найдена' });

  let bp = 10;
  if (perk_ids?.length) {
    const { data: perks } = await supabase.from('perks').select('*').in('id', perk_ids);
    for (const p of perks) bp += p.cost;
  }
  if (bp < 0) return res.status(400).json({ error: `Не хватает очков: ${bp}` });

  const { data: ch, error } = await supabase.from('characters').insert({
    user_id: req.user.id, campaign_id, name, profession_id,
    balance_points: bp, food: 100, water: 100, stress: 0
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const insertPromises = [];

  for (const ss of (prof.starter_skills || [])) {
    const { data: sk } = await supabase.from('skills').select('id').eq('name', ss.skill).single();
    if (sk) {
      insertPromises.push(
        supabase.from('character_skills').insert({
          character_id: ch.id, skill_id: sk.id, modifier: ss.modifier
        })
      );
    }
  }

  if (perk_ids?.length) {
    const pd = perk_data || [];
    for (const pid of perk_ids) {
      const pdd = pd.find(p => String(p.perk_id) === String(pid));
      insertPromises.push(
        supabase.from('character_perks').insert({
          character_id: ch.id,
          perk_id: pid,
          linked_perk_id: pdd?.linked_perk_id || null
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
  notifyCampaign(campaign_id, 'character_updated', { character_id: ch.id, updates: enriched });
  res.json(enriched);
});

// GET /api/characters/:id
router.get('/:id', authMiddleware, async (req, res) => {
  const { data: ch } = await supabase.from('characters').select('*').eq('id', req.params.id).single();
  if (!ch) return res.status(404).json({ error: 'Не найден' });
  const enriched = await enrichCharacter(ch);
  res.json(enriched);
});

// PUT /api/characters/:id/params
router.put('/:id/params', authMiddleware, async (req, res) => {
  const allowed = ['food', 'water', 'stress', 'carry_weight_max', 'currency'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }

  const { data, error } = await supabase.from('characters')
    .update(updates).eq('id', req.params.id).select('*').single();

  if (error) return res.status(500).json({ error: error.message });
  if (data?.campaign_id) {
    notifyCampaign(data.campaign_id, 'character_updated', {
      character_id: req.params.id, updates
    });
  }
  res.json(data);
});

// DELETE /api/characters/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  const { data: ch } = await supabase.from('characters')
    .select('campaign_id, user_id').eq('id', req.params.id).single();
  if (!ch) return res.status(404).json({ error: 'Персонаж не найден' });

  const { data: member } = await supabase.from('campaign_members')
    .select('role').eq('campaign_id', ch.campaign_id).eq('user_id', req.user.id).single();
  if (!member || !['master', 'co-master'].includes(member.role)) {
    return res.status(403).json({ error: 'Только для Мастера' });
  }

  await Promise.all([
    supabase.from('campaign_members').update({ character_id: null }).eq('character_id', req.params.id),
    supabase.from('inventory_slots').delete().eq('character_id', req.params.id),
    supabase.from('character_skills').delete().eq('character_id', req.params.id),
    supabase.from('character_perks').delete().eq('character_id', req.params.id),
    supabase.from('characters').delete().eq('id', req.params.id)
  ]);

  notifyCampaign(ch.campaign_id, 'character_deleted', { character_id: req.params.id });
  res.json({ success: true });
});

// GET /api/characters/:id/weight
router.get('/:id/weight', authMiddleware, async (req, res) => {
  const { data: ch } = await supabase.from('characters')
    .select('id, carry_weight_max').eq('id', req.params.id).single();
  if (!ch) return res.status(404).json({ error: 'Персонаж не найден' });

  const { data: slots } = await supabase.from('inventory_slots')
    .select('quantity, item:items(weight, slot, is_container), children:inventory_slots(quantity, item:items(weight))')
    .eq('character_id', ch.id).is('parent_slot_id', null);

  let totalWeight = 0;
  for (const s of (slots || [])) {
    if (s.item?.slot === 'currency') continue;
    totalWeight += (s.item?.weight || 0) * (s.quantity || 1);
    if (s.item?.is_container && s.children) {
      for (const child of s.children) {
        totalWeight += (child.item?.weight || 0) * (child.quantity || 1);
      }
    }
  }

  const maxWeight = ch.carry_weight_max || 50;
  const percent = Math.round((totalWeight / maxWeight) * 100);
  const { getWeightPenalty } = await import('../enrichCharacter.js');
  const penalty = getWeightPenalty(percent);

  res.json({ totalWeight, maxWeight, percent, penalty });
});

// POST /api/characters/:id/skills
router.post('/:id/skills', authMiddleware, async (req, res) => {
  const { skill_id, modifier } = req.body;
  const { data, error } = await supabase.from('character_skills')
    .insert({ character_id: req.params.id, skill_id, modifier: modifier || 0 })
    .select().single();

  if (error) return res.status(500).json({ error: error.message });

  const { data: ch } = await supabase.from('characters')
    .select('campaign_id').eq('id', req.params.id).single();
  if (ch?.campaign_id) {
    notifyCampaign(ch.campaign_id, 'character_skills_updated', { character_id: req.params.id });
  }
  res.json(data);
});

// PUT /api/characters/:id/skills/:skillId
router.put('/:id/skills/:skillId', authMiddleware, async (req, res) => {
  const { modifier } = req.body;
  const { data, error } = await supabase.from('character_skills')
    .update({ modifier }).eq('character_id', req.params.id)
    .eq('skill_id', req.params.skillId).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const { data: ch } = await supabase.from('characters')
    .select('campaign_id').eq('id', req.params.id).single();
  if (ch?.campaign_id) {
    notifyCampaign(ch.campaign_id, 'character_skills_updated', { character_id: req.params.id });
  }
  res.json(data);
});

// DELETE /api/characters/:id/skills/:skillId
router.delete('/:id/skills/:skillId', authMiddleware, async (req, res) => {
  await supabase.from('character_skills').delete()
    .eq('character_id', req.params.id).eq('skill_id', req.params.skillId);

  const { data: ch } = await supabase.from('characters')
    .select('campaign_id').eq('id', req.params.id).single();
  if (ch?.campaign_id) {
    notifyCampaign(ch.campaign_id, 'character_skills_updated', { character_id: req.params.id });
  }
  res.json({ success: true });
});

// GET /api/campaigns/:id/characters — персонажи кампании (мастер)
router.get('/campaigns/:campaignId/characters', authMiddleware, async (req, res) => {
  const { data: member } = await supabase.from('campaign_members')
    .select('role').eq('campaign_id', req.params.campaignId).eq('user_id', req.user.id).single();

  if (!member || !['master', 'co-master'].includes(member.role)) {
    return res.status(403).json({ error: 'Только для Мастера' });
  }

  const { data: members } = await supabase.from('campaign_members')
    .select('user_id, role, character_id')
    .eq('campaign_id', req.params.campaignId)
    .eq('role', 'player')
    .not('character_id', 'is', null);

  if (!members?.length) return res.json([]);

  const charIds = members.map(m => m.character_id);
  const { data: chars } = await supabase.from('characters').select('*').in('id', charIds);
  if (!chars?.length) return res.json([]);

  const enriched = await enrichCharacter(chars);
  const enrichedWithOwner = enriched.map(ch => {
    const owner = members.find(m => m.character_id === ch.id);
    return { ...ch, owner_role: owner?.role, owner_id: owner?.user_id };
  });

  res.json(enrichedWithOwner);
});

export default router;

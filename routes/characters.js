// routes/characters.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, validate, schemas } from '../middleware.js';
import { enrichCharacter, getWeightPenalty } from '../enrichCharacter.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// POST /api/characters
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
    balance_points: bp
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const insertPromises = [];

  // Стартовые навыки профессии
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

  // Перки
  if (perk_ids?.length) {
    const pd = perk_data || [];
    for (const pid of perk_ids) {
      const pdd = pd.find(p => String(p.perk_id) === String(pid));
      insertPromises.push(
        supabase.from('character_perks').insert({
          character_id: ch.id, perk_id: pid, linked_perk_id: pdd?.linked_perk_id || null
        })
      );
    }
  }

  // Статусы по умолчанию
  const { data: defaultStatuses } = await supabase.from('character_statuses').select('*').eq('is_global', true);
  for (const st of (defaultStatuses || [])) {
    insertPromises.push(
      supabase.from('character_status_values').insert({
        character_id: ch.id, status_id: st.id, value: st.default_value
      })
    );
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
router.put('/:id/params', authMiddleware, validate(schemas.updateCharacterParams), async (req, res) => {
  const { carry_weight_max, currency, statuses } = req.body;
  const updates = {};
  if (carry_weight_max !== undefined) updates.carry_weight_max = carry_weight_max;
  if (currency !== undefined) updates.currency = currency;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from('characters').update(updates).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }

  // Обновляем статусы
  if (statuses?.length) {
    for (const st of statuses) {
      await supabase.from('character_status_values')
        .upsert({ character_id: req.params.id, status_id: st.status_id, value: st.value },
          { onConflict: 'character_id, status_id' });
    }
  }

  const { data: ch } = await supabase.from('characters').select('*').eq('id', req.params.id).single();
  if (ch?.campaign_id) {
    notifyCampaign(ch.campaign_id, 'character_updated', { character_id: req.params.id, updates: req.body });
  }
  res.json({ success: true });
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
    supabase.from('character_status_values').delete().eq('character_id', req.params.id),
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
    .select('quantity, item:items(weight, item_slot_id, slot), children:inventory_slots(quantity, item:items(weight))')
    .eq('character_id', ch.id).is('parent_slot_id', null);

  let totalWeight = 0;
  for (const s of (slots || [])) {
    if (s.item?.slot === 'currency' || s.item?.item_slot_id === (await getSlotId('currency'))) continue;
    totalWeight += (s.item?.weight || 0) * (s.quantity || 1);
    if (s.children) {
      for (const child of s.children) {
        totalWeight += (child.item?.weight || 0) * (child.quantity || 1);
      }
    }
  }

  const maxWeight = ch.carry_weight_max || 50;
  const percent = Math.round((totalWeight / maxWeight) * 100);
  const penalty = getWeightPenalty(percent);

  res.json({ totalWeight, maxWeight, percent, penalty });
});

// POST /api/characters/:id/skills
router.post('/:id/skills', authMiddleware, async (req, res) => {
  const { skill_id, modifier } = req.body;
  const { data, error } = await supabase.from('character_skills')
    .insert({ character_id: req.params.id, skill_id, modifier: modifier || 0 }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', req.params.id).single();
  if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'character_skills_updated', { character_id: req.params.id });
  res.json(data);
});

// PUT /api/characters/:id/skills/:skillId
router.put('/:id/skills/:skillId', authMiddleware, async (req, res) => {
  const { modifier } = req.body;
  await supabase.from('character_skills').update({ modifier })
    .eq('character_id', req.params.id).eq('skill_id', req.params.skillId);

  const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', req.params.id).single();
  if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'character_skills_updated', { character_id: req.params.id });
  res.json({ success: true });
});

// DELETE /api/characters/:id/skills/:skillId
router.delete('/:id/skills/:skillId', authMiddleware, async (req, res) => {
  await supabase.from('character_skills').delete()
    .eq('character_id', req.params.id).eq('skill_id', req.params.skillId);

  const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', req.params.id).single();
  if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'character_skills_updated', { character_id: req.params.id });
  res.json({ success: true });
});

// GET /api/character-statuses
router.get('/statuses/global', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('character_statuses').select('*').eq('is_global', true).order('sort_order');
  res.json(data || []);
});

async function getSlotId(name) {
  const { data } = await supabase.from('item_slots').select('id').eq('name', name).single();
  return data?.id;
}

export default router;

// routes/campaigns.js
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase.js';
import { authMiddleware, adminMiddleware, validate, schemas } from '../middleware.js';
import { enrichCharacter } from '../enrichCharacter.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// POST /api/campaigns — создать (только admin)
router.post('/', authMiddleware, adminMiddleware, validate(schemas.createCampaign), async (req, res) => {
  const { title } = req.body;
  const invite_code = uuidv4().substring(0, 8);
  const { data: c, error } = await supabase.from('campaigns')
    .insert({ title, master_id: req.user.id, invite_code }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  await Promise.all([
    supabase.from('campaign_members').insert({ campaign_id: c.id, user_id: req.user.id, role: 'master' }),
    supabase.from('scenes').insert({ campaign_id: c.id, scene_type: 'local' }),
    supabase.from('scenes').insert({ campaign_id: c.id, scene_type: 'global' })
  ]);

  res.json(c);
});

// POST /api/campaigns/join/:code
router.post('/join/:code', authMiddleware, async (req, res) => {
  const { data: c } = await supabase.from('campaigns').select('*').eq('invite_code', req.params.code).single();
  if (!c) return res.status(404).json({ error: 'Кампания не найдена' });

  const { data: ex } = await supabase.from('campaign_members')
    .select('id').eq('campaign_id', c.id).eq('user_id', req.user.id).single();
  if (ex) return res.status(409).json({ error: 'Вы уже в кампании' });

  await supabase.from('campaign_members').insert({ campaign_id: c.id, user_id: req.user.id, role: 'player' });
  notifyCampaign(c.id, 'campaign_members_updated', { campaignId: c.id });
  res.json(c);
});

// GET /api/campaigns
router.get('/', authMiddleware, async (req, res) => {
  const { data: m } = await supabase.from('campaign_members')
    .select('campaign_id').eq('user_id', req.user.id);
  if (!m?.length) return res.json([]);

  const { data } = await supabase.from('campaigns').select('*').in('id', m.map(x => x.campaign_id));
  res.json(data);
});

// GET /api/campaigns/:id
router.get('/:id', authMiddleware, async (req, res) => {
  const { data: c } = await supabase.from('campaigns').select('*').eq('id', req.params.id).single();
  if (!c) return res.status(404).json({ error: 'Не найдена' });

  const { data: members } = await supabase.from('campaign_members')
    .select('user_id, role, character_id, user:users(username)').eq('campaign_id', c.id);
  res.json({ ...c, members });
});

// PUT /api/campaigns/:id/time
router.put('/:id/time', authMiddleware, async (req, res) => {
  const { game_time } = req.body;
  const { data, error } = await supabase.from('campaigns')
    .update({ game_time }).eq('id', req.params.id).select().single();

  if (error) return res.status(500).json({ error: error.message });
  notifyCampaign(req.params.id, 'campaign_updated', data);
  res.json(data);
});

// DELETE /api/campaigns/:id/members/:userId
router.delete('/:id/members/:userId', authMiddleware, async (req, res) => {
  const { data: member } = await supabase.from('campaign_members')
    .select('role').eq('campaign_id', req.params.id).eq('user_id', req.user.id).single();

  if (!member || !['master', 'co-master'].includes(member.role)) {
    return res.status(403).json({ error: 'Только для Мастера' });
  }
  if (req.user.id === req.params.userId) {
    return res.status(400).json({ error: 'Нельзя выгнать самого себя' });
  }

  await supabase.from('campaign_members').delete()
    .eq('campaign_id', req.params.id).eq('user_id', req.params.userId);
  notifyCampaign(req.params.id, 'campaign_members_updated', { campaignId: req.params.id });
  res.json({ success: true });
});

// GET /api/campaigns/:campaignId/characters — персонажи кампании (мастер)
router.get('/:campaignId/characters', authMiddleware, async (req, res) => {
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

// ===== BASE INVENTORY =====

// GET /api/campaigns/:id/base
router.get('/:id/base', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('base_inventory')
    .select('*, item:items(*)').eq('campaign_id', req.params.id)
    .order('created_at', { ascending: false });
  res.json(data || []);
});

// POST /api/campaigns/:id/base/deposit
router.post('/:id/base/deposit', authMiddleware, async (req, res) => {
  const { slot_id, quantity } = req.body;
  const { data: slot } = await supabase.from('inventory_slots')
    .select('*, item:items(*)').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Предмет не найден в инвентаре' });

  const { data: ch } = await supabase.from('characters').select('user_id').eq('id', slot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const depositQty = Math.min(quantity || 1, slot.quantity);
  const { data: existing } = await supabase.from('base_inventory')
    .select('*').eq('campaign_id', req.params.id).eq('item_id', slot.item_id).single();

  if (existing) {
    await supabase.from('base_inventory').update({ quantity: existing.quantity + depositQty }).eq('id', existing.id);
  } else {
    await supabase.from('base_inventory').insert({
      campaign_id: req.params.id, item_id: slot.item_id,
      quantity: depositQty, added_by: req.user.id
    });
  }

  const remaining = slot.quantity - depositQty;
  if (remaining <= 0) await supabase.from('inventory_slots').delete().eq('id', slot_id);
  else await supabase.from('inventory_slots').update({ quantity: remaining }).eq('id', slot_id);

  notifyCampaign(req.params.id, 'inventory_updated', { character_id: slot.character_id });
  notifyCampaign(req.params.id, 'base_updated', { campaignId: req.params.id });

  const { data: charData } = await supabase.from('characters').select('name').eq('id', slot.character_id).single();
  const msgText = `${charData?.name || 'Игрок'} сдал на базу: ${slot.item?.name} ×${depositQty}`;
  const { data: msg } = await supabase.from('chat_messages').insert({
    campaign_id: req.params.id, user_id: req.user.id,
    username: charData?.name || 'Игрок', text: msgText, is_roll: false
  }).select().single();
  if (msg) notifyCampaign(req.params.id, 'chat_message', msg);

  res.json({ success: true });
});

// POST /api/campaigns/:id/base/withdraw
router.post('/:id/base/withdraw', authMiddleware, async (req, res) => {
  const { base_item_id, quantity } = req.body;
  const { data: member } = await supabase.from('campaign_members')
    .select('character_id').eq('campaign_id', req.params.id).eq('user_id', req.user.id).single();
  if (!member?.character_id) return res.status(400).json({ error: 'У вас нет персонажа' });

  const { data: baseItem } = await supabase.from('base_inventory')
    .select('*, item:items(*)').eq('id', base_item_id).single();
  if (!baseItem) return res.status(404).json({ error: 'Предмет не найден на базе' });

  const withdrawQty = Math.min(quantity || 1, baseItem.quantity);
  await supabase.from('inventory_slots').insert({
    character_id: member.character_id, item_id: baseItem.item_id,
    quantity: withdrawQty, slot_type: 'рюкзак', equipped: false
  });

  const remaining = baseItem.quantity - withdrawQty;
  if (remaining <= 0) await supabase.from('base_inventory').delete().eq('id', base_item_id);
  else await supabase.from('base_inventory').update({ quantity: remaining }).eq('id', base_item_id);

  notifyCampaign(req.params.id, 'inventory_updated', { character_id: member.character_id });
  notifyCampaign(req.params.id, 'base_updated', { campaignId: req.params.id });

  const { data: charData } = await supabase.from('characters').select('name').eq('id', member.character_id).single();
  const msgText = `${charData?.name || 'Игрок'} взял с базы: ${baseItem.item?.name} ×${withdrawQty}`;
  const { data: msg } = await supabase.from('chat_messages').insert({
    campaign_id: req.params.id, user_id: req.user.id,
    username: charData?.name || 'Игрок', text: msgText, is_roll: false
  }).select().single();
  if (msg) notifyCampaign(req.params.id, 'chat_message', msg);

  res.json({ success: true });
});

// PUT /api/campaigns/:id/base/access
router.put('/:id/base/access', authMiddleware, async (req, res) => {
  const { data: member } = await supabase.from('campaign_members')
    .select('role').eq('campaign_id', req.params.id).eq('user_id', req.user.id).single();
  if (!member || !['master', 'co-master'].includes(member.role)) {
    return res.status(403).json({ error: 'Только для Мастера' });
  }

  const { base_access } = req.body;
  await supabase.from('campaigns').update({ base_access }).eq('id', req.params.id);
  notifyCampaign(req.params.id, 'base_updated', { campaignId: req.params.id });
  res.json({ success: true, base_access });
});

// ===== LOOT =====

// GET /api/campaigns/:id/loot
router.get('/:id/loot', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('loot_pools')
    .select('*').eq('campaign_id', req.params.id).order('created_at', { ascending: false });
  res.json(data || []);
});

// POST /api/campaigns/:id/loot
router.post('/:id/loot', authMiddleware, async (req, res) => {
  const { name, items } = req.body;
  const { data: member } = await supabase.from('campaign_members')
    .select('role').eq('campaign_id', req.params.id).eq('user_id', req.user.id).single();
  if (!member || !['master', 'co-master'].includes(member.role)) {
    return res.status(403).json({ error: 'Только для Мастера' });
  }
  const { data, error } = await supabase.from('loot_pools')
    .insert({ campaign_id: req.params.id, name, items: items || [] }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;

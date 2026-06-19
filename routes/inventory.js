// routes/inventory.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// POST /api/inventory/add
router.post('/add', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity, slot_type } = req.body;
  const { data: ch } = await supabase.from('characters').select('user_id, campaign_id').eq('id', character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });
  const { data: item } = await supabase.from('items').select('*, item_slot:item_slots(*)').eq('id', item_id).single();
  const slotName = item?.item_slot?.name || item?.slot;
  const st = slot_type || (['armor','exo'].includes(slotName) ? slotName : 'рюкзак');

  const { data: existing } = await supabase.from('inventory_slots')
    .select('*').eq('character_id', character_id).eq('item_id', item_id).eq('slot_type', st).single();

  if (existing && !['правая_рука','левая_рука','тело','экзоскелет','голова','плечи','ноги'].includes(st)) {
    const { data, error } = await supabase.from('inventory_slots')
      .update({ quantity: existing.quantity + (quantity || 1) }).eq('id', existing.id)
      .select('*, item:items(*, ammo_type:ammo_types(*), item_slot:item_slots(*))').single();
    if (error) return res.status(500).json({ error: error.message });
    if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id });
    return res.json(data);
  }

  const { data, error } = await supabase.from('inventory_slots').insert({
    character_id, item_id, quantity: quantity || 1, slot_type: st, equipped: false, position: 0
  }).select('*, item:items(*, ammo_type:ammo_types(*), item_slot:item_slots(*))').single();
  if (error) return res.status(500).json({ error: error.message });

  if (slotName === 'container' && item.container_items?.length > 0) {
    for (const ci of item.container_items) {
      const { data: childItem } = await supabase.from('items').select('*').eq('id', ci.item_id).single();
      if (childItem) {
        await supabase.from('inventory_slots').insert({
          character_id, item_id: ci.item_id, quantity: ci.quantity || 1,
          slot_type: 'container', equipped: false, position: 0, parent_slot_id: data.id
        });
      }
    }
  }

  if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id });
  res.json(data);
});

// POST /api/inventory/remove
router.post('/remove', authMiddleware, async (req, res) => {
  const { slot_id, quantity } = req.body;
  const { data: slot } = await supabase.from('inventory_slots')
    .select('*, character:characters(campaign_id, user_id)').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });
  if (slot.character?.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });
  const nq = slot.quantity - (quantity || 1);
  if (nq <= 0) await supabase.from('inventory_slots').delete().eq('id', slot_id);
  else await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', slot_id);
  if (slot.character?.campaign_id) notifyCampaign(slot.character.campaign_id, 'inventory_updated', { character_id: slot.character_id });
  res.json(nq <= 0 ? { deleted: true } : { success: true });
});

// POST /api/inventory/equip
router.post('/equip', authMiddleware, async (req, res) => {
  const { slot_id, cell_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots')
    .select('*, item:items(*, item_slot:item_slots(*))').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });
  const { data: ch } = await supabase.from('characters').select('user_id, campaign_id').eq('id', slot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const rules = slot.item?.item_slot?.rules || {};
  if (!rules.equippable) return res.status(400).json({ error: 'Этот предмет нельзя экипировать' });
  const cid = slot.character_id;

  if (cell_id) {
    const { data: cell } = await supabase.from('inventory_cells').select('*, item_slot:item_slots(*)').eq('id', cell_id).single();
    if (!cell) return res.status(400).json({ error: 'Ячейка не найдена' });
    if (cell.item_slot_id && cell.item_slot_id !== slot.item?.item_slot_id) {
      return res.status(400).json({ error: `В "${cell.name}" нельзя экипировать "${slot.item?.item_slot?.name}"` });
    }
    await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' })
      .eq('character_id', cid).eq('equipped', true).eq('slot_type', cell.name);
    const { data } = await supabase.from('inventory_slots')
      .update({ equipped: true, slot_type: cell.name }).eq('id', slot_id)
      .select('*, item:items(*, ammo_type:ammo_types(*), item_slot:item_slots(*))').single();
    if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: cid });
    return res.json(data);
  }

  const { data: cells } = await supabase.from('inventory_cells')
    .select('*').eq('item_slot_id', slot.item?.item_slot_id).order('sort_order');
  if (cells?.length > 0) {
    const targetCell = cells[0];
    await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' })
      .eq('character_id', cid).eq('equipped', true).eq('slot_type', targetCell.name);
    const { data } = await supabase.from('inventory_slots')
      .update({ equipped: true, slot_type: targetCell.name }).eq('id', slot_id)
      .select('*, item:items(*, ammo_type:ammo_types(*), item_slot:item_slots(*))').single();
    if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: cid });
    return res.json(data);
  }

  res.status(400).json({ error: 'Нет подходящей ячейки для экипировки' });
});

// POST /api/inventory/unequip
router.post('/unequip', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots')
    .select('*, item:items(*, item_slot:item_slots(*))').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });
  const { data: ch } = await supabase.from('characters').select('user_id, campaign_id').eq('id', slot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });
  const { data } = await supabase.from('inventory_slots')
    .update({ equipped: false, slot_type: 'рюкзак' }).eq('id', slot_id)
    .select('*, item:items(*, ammo_type:ammo_types(*), item_slot:item_slots(*))').single();
  if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: slot.character_id });
  res.json(data);
});

// POST /api/inventory/use
router.post('/use', authMiddleware, async (req, res) => {
  const { slot_id, shots_count } = req.body;
  const { data: slot } = await supabase.from('inventory_slots')
    .select('*, item:items(*, item_slot:item_slots(*))').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });
  const { data: ch } = await supabase.from('characters').select('user_id, name, campaign_id').eq('id', slot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const item = slot.item;
  const rules = item?.item_slot?.rules || {};
  const actions = rules.actions || [];
  const attackAction = actions.find(a => a.name === 'attack') || actions[0];
  if (!attackAction) return res.status(400).json({ error: 'Нет доступных действий' });

  if (attackAction.consume_ammo && slot.equipped) {
    const currentAmmo = item.current_ammo || 0;
    const ammoPerShot = item.ammo_per_shot || 1;
    const maxShots = item.shots_per_action || 1;
    const requestedShots = Math.min(shots_count || maxShots, maxShots);
    const possibleShots = Math.min(requestedShots, Math.floor(currentAmmo / ammoPerShot));
    if (possibleShots <= 0) return res.status(400).json({ error: 'Нет патронов' });
    const consumed = possibleShots * ammoPerShot;
    await supabase.from('items').update({ current_ammo: currentAmmo - consumed }).eq('id', item.id);
    const rolls = [];
    if (attackAction.roll_per_shot) for (let i = 0; i < possibleShots; i++) rolls.push(Math.floor(Math.random() * 20) + 1);
    if (ch.campaign_id) {
      const msgText = `${ch.name} ${attackAction.label || 'использовал'} ${item.name}${rolls.length ? ' [' + rolls.join(', ') + ']' : ''}`;
      await supabase.from('chat_messages').insert({
        campaign_id: ch.campaign_id, user_id: req.user.id, username: ch.name, text: msgText, is_roll: attackAction.roll_per_shot
      }).select().single();
      notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: slot.character_id });
    }
    return res.json({ action: attackAction.name, shots: possibleShots, rolls, remaining_ammo: currentAmmo - consumed });
  }

  if (attackAction.destroy_on_use) {
    await supabase.from('inventory_slots').delete().eq('id', slot_id);
    if (ch.campaign_id) {
      const msgText = `${ch.name} ${attackAction.label || 'использовал'} ${item.name}`;
      await supabase.from('chat_messages').insert({
        campaign_id: ch.campaign_id, user_id: req.user.id, username: ch.name, text: msgText, is_roll: false
      }).select().single();
      notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: slot.character_id });
    }
    return res.json({ action: attackAction.name, destroyed: true });
  }

  const nq = slot.quantity - 1;
  if (nq <= 0) await supabase.from('inventory_slots').delete().eq('id', slot_id);
  else await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', slot_id);
  if (ch.campaign_id) {
    const msgText = `${ch.name} ${attackAction.label || 'использовал'} ${item.name}`;
    await supabase.from('chat_messages').insert({
      campaign_id: ch.campaign_id, user_id: req.user.id, username: ch.name, text: msgText, is_roll: false
    }).select().single();
    notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: slot.character_id });
  }
  res.json({ action: attackAction.name, remaining: Math.max(0, nq) });
});

// POST /api/inventory/reload
router.post('/reload', authMiddleware, async (req, res) => {
  const { slot_id, ammo_type_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots')
    .select('*, item:items(*, item_slot:item_slots(*))').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });

  const rules = slot.item?.item_slot?.rules || {};
  const hasReload = (rules.actions || []).some(a => a.name === 'reload');
  if (!hasReload) return res.status(400).json({ error: 'Этот предмет нельзя перезарядить' });

  const { data: ch } = await supabase.from('characters').select('user_id, campaign_id').eq('id', slot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const searchTypeId = ammo_type_id || slot.item.ammo_type_id;
  if (!searchTypeId) return res.status(400).json({ error: 'Не указан тип патронов' });

  const maxAmmo = slot.item.max_ammo || 0;
  const currentAmmo = slot.item.current_ammo || 0;
  const needed = maxAmmo - currentAmmo;
  if (needed <= 0) return res.status(400).json({ error: 'Магазин уже полон' });

  const { data: allSlots } = await supabase.from('inventory_slots')
    .select('*, item:items(*)').eq('character_id', slot.character_id).eq('equipped', false);
  const ammoSlot = allSlots?.find(s => s.item?.ammo_type_id === searchTypeId);
  if (!ammoSlot) return res.status(400).json({ error: 'Нет подходящих патронов' });

  const ammoAvailable = ammoSlot.quantity;
  const toReload = Math.min(needed, ammoAvailable);
  await supabase.from('items').update({ current_ammo: currentAmmo + toReload }).eq('id', slot.item.id);
  const remaining = ammoAvailable - toReload;
  if (remaining <= 0) await supabase.from('inventory_slots').delete().eq('id', ammoSlot.id);
  else await supabase.from('inventory_slots').update({ quantity: remaining }).eq('id', ammoSlot.id);
  if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: slot.character_id });
  res.json({ success: true, current_ammo: currentAmmo + toReload, max_ammo, used: toReload });
});

// PUT /api/inventory/:slotId
router.put('/:slotId', authMiddleware, async (req, res) => {
  const { condition_percent, equipped, slot_type, quantity } = req.body;
  const updates = {};
  if (condition_percent !== undefined) updates.condition_percent = condition_percent;
  if (equipped !== undefined) updates.equipped = equipped;
  if (slot_type !== undefined) updates.slot_type = slot_type;
  if (quantity !== undefined) updates.quantity = quantity;
  const { data } = await supabase.from('inventory_slots').update(updates).eq('id', req.params.slotId)
    .select('*, item:items(*, ammo_type:ammo_types(*), item_slot:item_slots(*))').single();
  if (data?.character_id) {
    const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', data.character_id).single();
    if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: data.character_id });
  }
  res.json(data);
});

// POST /api/inventory/:slotId/mod
router.post('/:slotId/mod', authMiddleware, async (req, res) => {
  const { mod_item_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots')
    .select('*, item:items(*, item_slot:item_slots(*))').eq('id', req.params.slotId).single();
  if (!slot) return res.status(404).json({ error: 'Предмет не найден' });
  const { data: modItem } = await supabase.from('items').select('*, item_slot:item_slots(*)').eq('id', mod_item_id).single();
  if (!modItem || modItem.item_slot?.name !== 'mod') return res.status(400).json({ error: 'Это не модификация' });
  if (modItem.mod_item_slot_id && modItem.mod_item_slot_id !== slot.item?.item_slot_id) {
    return res.status(400).json({ error: 'Модификация не подходит' });
  }
  const mods = slot.mods || [];
  if (mods.find(m => m.id === modItem.id)) return res.status(400).json({ error: 'Модификация уже установлена' });
  mods.push({ id: modItem.id, name: modItem.name, description: modItem.description });
  const { data } = await supabase.from('inventory_slots').update({ mods }).eq('id', req.params.slotId)
    .select('*, item:items(*, ammo_type:ammo_types(*), item_slot:item_slots(*))').single();
  if (data?.character_id) {
    const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', data.character_id).single();
    if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: data.character_id });
  }
  res.json(data);
});

// DELETE /api/inventory/:slotId/mod/:modItemId
router.delete('/:slotId/mod/:modItemId', authMiddleware, async (req, res) => {
  const { data: slot } = await supabase.from('inventory_slots').select('*').eq('id', req.params.slotId).single();
  if (!slot) return res.status(404).json({ error: 'Предмет не найден' });
  const mods = (slot.mods || []).filter(m => m.id !== req.params.modItemId);
  const { data } = await supabase.from('inventory_slots').update({ mods }).eq('id', req.params.slotId)
    .select('*, item:items(*, ammo_type:ammo_types(*), item_slot:item_slots(*))').single();
  if (data?.character_id) {
    const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', data.character_id).single();
    if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: data.character_id });
  }
  res.json(data);
});

// POST /api/inventory/container/take
router.post('/container/take', authMiddleware, async (req, res) => {
  const { slot_id, child_slot_id, quantity } = req.body;
  const { data: childSlot } = await supabase.from('inventory_slots')
    .select('*, item:items(*, item_slot:item_slots(*))').eq('id', child_slot_id).single();
  if (!childSlot) return res.status(404).json({ error: 'Предмет не найден' });
  const { data: parentSlot } = await supabase.from('inventory_slots')
    .select('*, item:items(*, item_slot:item_slots(*))').eq('id', slot_id).single();
  if (!parentSlot || parentSlot.item?.item_slot?.name !== 'container') return res.status(400).json({ error: 'Это не контейнер' });
  const { data: ch } = await supabase.from('characters').select('user_id, campaign_id').eq('id', parentSlot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const takeQty = Math.min(quantity || 1, childSlot.quantity || 1);
  await supabase.from('inventory_slots').insert({
    character_id: parentSlot.character_id, item_id: childSlot.item_id,
    quantity: takeQty, slot_type: 'рюкзак', equipped: false, position: 0
  });
  const remaining = (childSlot.quantity || 1) - takeQty;
  if (remaining <= 0) await supabase.from('inventory_slots').delete().eq('id', child_slot_id);
  else await supabase.from('inventory_slots').update({ quantity: remaining }).eq('id', child_slot_id);
  if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: parentSlot.character_id });
  res.json({ success: true, taken: takeQty, remaining: Math.max(0, remaining) });
});

// POST /api/inventory/container/use
router.post('/container/use', authMiddleware, async (req, res) => {
  const { slot_id, child_slot_id } = req.body;
  const { data: childSlot } = await supabase.from('inventory_slots')
    .select('*, item:items(*, item_slot:item_slots(*))').eq('id', child_slot_id).single();
  if (!childSlot) return res.status(404).json({ error: 'Предмет не найден' });
  const { data: parentSlot } = await supabase.from('inventory_slots')
    .select('*, item:items(*, item_slot:item_slots(*))').eq('id', slot_id).single();
  if (!parentSlot || parentSlot.item?.item_slot?.name !== 'container') return res.status(400).json({ error: 'Это не контейнер' });
  const { data: ch } = await supabase.from('characters').select('user_id, name, campaign_id').eq('id', parentSlot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const item = childSlot.item;
  const rules = item.item_slot?.rules || {};
  const actions = rules.actions || [];
  const useAction = actions[0];
  const slotName = item.item_slot?.name || item.slot;

  if (slotName === 'consumable' || (useAction && !useAction.consume_ammo && !useAction.destroy_on_use)) {
    const nq = (childSlot.quantity || 1) - 1;
    if (nq <= 0) await supabase.from('inventory_slots').delete().eq('id', child_slot_id);
    else await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', child_slot_id);
    if (ch.campaign_id) {
      await supabase.from('chat_messages').insert({
        campaign_id: ch.campaign_id, user_id: req.user.id, username: ch.name,
        text: `${ch.name} использовал из контейнера ${item.name}`, is_roll: false
      }).select().single();
      notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: parentSlot.character_id });
    }
    return res.json({ used: 'consumable', remaining: Math.max(0, nq) });
  }

  if (slotName === 'ammo') {
    const { data: equipped } = await supabase.from('inventory_slots')
      .select('*, item:items(*)').eq('character_id', parentSlot.character_id).eq('equipped', true)
      .eq('item.ammo_type_id', item.ammo_type_id).single();
    if (!equipped) return res.status(400).json({ error: 'Нет подходящего оружия' });
    const maxAmmo = equipped.item.max_ammo || 0;
    const currentAmmo = equipped.item.current_ammo || 0;
    const needed = maxAmmo - currentAmmo;
    if (needed <= 0) return res.status(400).json({ error: 'Магазин полон' });
    const toReload = Math.min(needed, childSlot.quantity || 1);
    await supabase.from('items').update({ current_ammo: currentAmmo + toReload }).eq('id', equipped.item.id);
    const remaining = (childSlot.quantity || 1) - toReload;
    if (remaining <= 0) await supabase.from('inventory_slots').delete().eq('id', child_slot_id);
    else await supabase.from('inventory_slots').update({ quantity: remaining }).eq('id', child_slot_id);
    if (ch.campaign_id) {
      await supabase.from('chat_messages').insert({
        campaign_id: ch.campaign_id, user_id: req.user.id, username: ch.name,
        text: `${ch.name} перезарядил из контейнера ${item.name} (${toReload})`, is_roll: false
      }).select().single();
      notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: parentSlot.character_id });
    }
    return res.json({ used: 'ammo', reloaded: toReload });
  }

  res.status(400).json({ error: 'Нельзя использовать из контейнера' });
});

export default router;

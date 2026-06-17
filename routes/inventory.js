// routes/inventory.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// POST /api/inventory/add
router.post('/add', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity, slot_type } = req.body;

  const { data: ch } = await supabase.from('characters')
    .select('user_id, campaign_id').eq('id', character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const { data: item } = await supabase.from('items').select('*').eq('id', item_id).single();
  const st = slot_type || (item?.slot === 'weapon' ? 'рюкзак' :
    item?.slot === 'armor' ? 'тело' : item?.slot === 'exo' ? 'экзоскелет' : 'рюкзак');

  const { data: existing } = await supabase.from('inventory_slots')
    .select('*').eq('character_id', character_id).eq('item_id', item_id).eq('slot_type', st).single();

  if (existing && !['правая_рука', 'левая_рука', 'тело', 'экзоскелет'].includes(st)) {
    const { data, error } = await supabase.from('inventory_slots')
      .update({ quantity: existing.quantity + (quantity || 1) })
      .eq('id', existing.id)
      .select('*, item:items(*, ammo_type:ammo_types(*))').single();
    if (error) return res.status(500).json({ error: error.message });
    if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id });
    return res.json(data);
  }

  const { data, error } = await supabase.from('inventory_slots').insert({
    character_id, item_id, quantity: quantity || 1,
    slot_type: st, equipped: false, position: 0
  }).select('*, item:items(*, ammo_type:ammo_types(*))').single();

  if (error) return res.status(500).json({ error: error.message });

  if (item?.is_container && item.container_items?.length > 0) {
    const parentSlotId = data.id;
    for (const ci of item.container_items) {
      const { data: childItem } = await supabase.from('items').select('*').eq('id', ci.item_id).single();
      if (childItem) {
        await supabase.from('inventory_slots').insert({
          character_id, item_id: ci.item_id, quantity: ci.quantity || 1,
          slot_type: 'container', equipped: false, position: 0, parent_slot_id: parentSlotId
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
  if (nq <= 0) {
    await supabase.from('inventory_slots').delete().eq('id', slot_id);
  } else {
    await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', slot_id);
  }

  if (slot.character?.campaign_id) {
    notifyCampaign(slot.character.campaign_id, 'inventory_updated', { character_id: slot.character_id });
  }
  res.json(nq <= 0 ? { deleted: true } : { success: true });
});

// POST /api/inventory/equip
router.post('/equip', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots')
    .select('*, item:items(*)').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });

  const { data: ch } = await supabase.from('characters')
    .select('user_id, campaign_id').eq('id', slot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const item = slot.item;
  const cid = slot.character_id;

  if (item.slot === 'weapon') {
    const { data: hands } = await supabase.from('inventory_slots')
      .select('*, item:items(*)').eq('character_id', cid).eq('equipped', true)
      .in('slot_type', ['правая_рука', 'левая_рука']);

    let usedSlots = 0;
    for (const h of hands) usedSlots += (h.item?.is_heavy ? 2 : 1);
    const needed = item.is_heavy ? 2 : 1;
    if (usedSlots + needed > 2) return res.status(400).json({ error: 'Не хватает слотов рук' });

    if (item.is_heavy) {
      for (const h of hands) {
        await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('id', h.id);
      }
      const { data, error } = await supabase.from('inventory_slots')
        .update({ equipped: true, slot_type: 'правая_рука' }).eq('id', slot_id)
        .select('*, item:items(*, ammo_type:ammo_types(*))').single();
      if (error) return res.status(500).json({ error: error.message });
      if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: cid });
      return res.json(data);
    } else {
      const occupiedSlots = hands.map(h => h.slot_type);
      let target = 'правая_рука';
      if (occupiedSlots.includes('правая_рука') && !occupiedSlots.includes('левая_рука')) {
        target = 'левая_рука';
      } else if (occupiedSlots.includes('правая_рука') && occupiedSlots.includes('левая_рука')) {
        const left = hands.find(h => h.slot_type === 'левая_рука');
        if (left) await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('id', left.id);
        target = 'левая_рука';
      } else if (occupiedSlots.includes('левая_рука') && !occupiedSlots.includes('правая_рука')) {
        target = 'правая_рука';
      }
      const { data, error } = await supabase.from('inventory_slots')
        .update({ equipped: true, slot_type: target }).eq('id', slot_id)
        .select('*, item:items(*, ammo_type:ammo_types(*))').single();
      if (error) return res.status(500).json({ error: error.message });
      if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: cid });
      return res.json(data);
    }
  }

  if (item.slot === 'armor') {
    await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' })
      .eq('character_id', cid).eq('slot_type', 'тело').neq('id', slot_id);
    const { data, error } = await supabase.from('inventory_slots')
      .update({ equipped: true, slot_type: 'тело' }).eq('id', slot_id)
      .select('*, item:items(*, ammo_type:ammo_types(*))').single();
    if (error) return res.status(500).json({ error: error.message });
    if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: cid });
    return res.json(data);
  }

  if (item.slot === 'exo') {
    await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' })
      .eq('character_id', cid).eq('slot_type', 'экзоскелет').neq('id', slot_id);
    const { data, error } = await supabase.from('inventory_slots')
      .update({ equipped: true, slot_type: 'экзоскелет' }).eq('id', slot_id)
      .select('*, item:items(*, ammo_type:ammo_types(*))').single();
    if (error) return res.status(500).json({ error: error.message });
    if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: cid });
    return res.json(data);
  }

  res.status(400).json({ error: 'Нельзя экипировать' });
});

// POST /api/inventory/unequip
router.post('/unequip', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots')
    .select('*, item:items(*)').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });

  const { data: ch } = await supabase.from('characters')
    .select('user_id, campaign_id').eq('id', slot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const { data, error } = await supabase.from('inventory_slots')
    .update({ equipped: false, slot_type: 'рюкзак' }).eq('id', slot_id)
    .select('*, item:items(*, ammo_type:ammo_types(*))').single();
  if (error) return res.status(500).json({ error: error.message });
  if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: slot.character_id });
  res.json(data);
});

// POST /api/inventory/use
router.post('/use', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots')
    .select('*, item:items(*)').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });

  const { data: ch } = await supabase.from('characters')
    .select('user_id, name, campaign_id').eq('id', slot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const item = slot.item;
  let result = null;

  if (item.weapon_type === 'ranged' && slot.equipped) {
    if ((item.current_ammo || 0) <= 0) return res.status(400).json({ error: 'Нет патронов' });
    await supabase.from('items').update({ current_ammo: (item.current_ammo || 1) - 1 }).eq('id', item.id);
    result = { used: 'ammo', remaining: (item.current_ammo || 1) - 1, action: 'выстрелил из' };
  } else if (item.weapon_type === 'thrown' && slot.equipped) {
    await supabase.from('inventory_slots').delete().eq('id', slot_id);
    result = { used: 'thrown', deleted: true, action: 'метнул' };
  } else if (item.slot === 'consumable') {
    const nq = slot.quantity - 1;
    if (nq <= 0) {
      await supabase.from('inventory_slots').delete().eq('id', slot_id);
      result = { used: 'consumable', deleted: true, action: 'использовал' };
    } else {
      await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', slot_id);
      result = { used: 'consumable', remaining: nq, action: 'использовал' };
    }
  } else {
    return res.status(400).json({ error: 'Нельзя использовать' });
  }

  if (ch.campaign_id) {
    const msgText = `${ch.name} ${result.action} ${item.name}`;
    const { data: msg } = await supabase.from('chat_messages').insert({
      campaign_id: ch.campaign_id, user_id: req.user.id,
      username: ch.name, text: msgText, is_roll: false
    }).select().single();
    if (msg) notifyCampaign(ch.campaign_id, 'chat_message', msg);
    notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: slot.character_id });
  }
  res.json(result);
});

// POST /api/inventory/reload
router.post('/reload', authMiddleware, async (req, res) => {
  const { slot_id, ammo_type_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots')
    .select('*, item:items(*)').eq('id', slot_id).single();

  if (!slot || slot.item?.slot !== 'weapon' || slot.item?.weapon_type !== 'ranged') {
    return res.status(400).json({ error: 'Не дальнобойное оружие' });
  }

  const { data: ch } = await supabase.from('characters')
    .select('user_id, campaign_id').eq('id', slot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const acceptedTypes = slot.item.accepted_ammo_types || [];
  if (acceptedTypes.length > 0 && ammo_type_id && !acceptedTypes.includes(ammo_type_id)) {
    return res.status(400).json({ error: 'Этот тип патронов не подходит' });
  }

  const searchTypeId = ammo_type_id || slot.item.ammo_type_id;
  if (!searchTypeId) return res.status(400).json({ error: 'Не указан тип патронов' });

  const maxAmmo = slot.item.max_ammo || 0;
  const currentAmmo = slot.item.current_ammo || 0;
  const needed = maxAmmo - currentAmmo;
  if (needed <= 0) return res.status(400).json({ error: 'Магазин уже полон' });

  const { data: allSlots } = await supabase.from('inventory_slots')
    .select('*, item:items(*)').eq('character_id', slot.character_id)
    .eq('equipped', false).eq('item.slot', 'ammo');
  const ammoSlot = allSlots?.find(s => s.item?.ammo_type_id === searchTypeId);
  if (!ammoSlot) return res.status(400).json({ error: 'Нет подходящих патронов' });

  const ammoAvailable = ammoSlot.quantity;
  const toReload = Math.min(needed, ammoAvailable);

  await supabase.from('items').update({ current_ammo: currentAmmo + toReload }).eq('id', slot.item.id);
  const remaining = ammoAvailable - toReload;
  if (remaining <= 0) await supabase.from('inventory_slots').delete().eq('id', ammoSlot.id);
  else await supabase.from('inventory_slots').update({ quantity: remaining }).eq('id', ammoSlot.id);

  if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: slot.character_id });
  res.json({
    success: true, current_ammo: currentAmmo + toReload, max_ammo,
    used: toReload, remaining_ammo_in_inventory: Math.max(0, remaining)
  });
});

// PUT /api/inventory/:slotId
router.put('/:slotId', authMiddleware, async (req, res) => {
  const { condition_percent, equipped, slot_type, quantity } = req.body;
  const updates = {};
  if (condition_percent !== undefined) updates.condition_percent = condition_percent;
  if (equipped !== undefined) updates.equipped = equipped;
  if (slot_type !== undefined) updates.slot_type = slot_type;
  if (quantity !== undefined) updates.quantity = quantity;

  const { data, error } = await supabase.from('inventory_slots')
    .update(updates).eq('id', req.params.slotId)
    .select('*, item:items(*, ammo_type:ammo_types(*))').single();

  if (error) return res.status(500).json({ error: error.message });
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
    .select('*, item:items(*)').eq('id', req.params.slotId).single();
  if (!slot) return res.status(404).json({ error: 'Предмет не найден' });

  const { data: modItem } = await supabase.from('items').select('*').eq('id', mod_item_id).single();
  if (!modItem || modItem.slot !== 'mod') return res.status(400).json({ error: 'Это не модификация' });
  if (modItem.mod_target !== 'any' && modItem.mod_target !== slot.item?.slot) {
    return res.status(400).json({ error: 'Модификация не подходит к этому типу предмета' });
  }
  if (modItem.mod_target === 'weapon' && modItem.weapon_mod_subtype &&
      modItem.weapon_mod_subtype !== 'any' && modItem.weapon_mod_subtype !== slot.item?.weapon_type) {
    return res.status(400).json({ error: 'Модификация не подходит к этому типу оружия' });
  }

  const mods = slot.mods || [];
  if (mods.find(m => m.id === modItem.id)) {
    return res.status(400).json({ error: 'Модификация уже установлена' });
  }
  mods.push({ id: modItem.id, name: modItem.name, description: modItem.description });

  const { data, error } = await supabase.from('inventory_slots')
    .update({ mods }).eq('id', req.params.slotId)
    .select('*, item:items(*, ammo_type:ammo_types(*))').single();

  if (error) return res.status(500).json({ error: error.message });
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
  const { data, error } = await supabase.from('inventory_slots')
    .update({ mods }).eq('id', req.params.slotId)
    .select('*, item:items(*, ammo_type:ammo_types(*))').single();

  if (error) return res.status(500).json({ error: error.message });
  if (data?.character_id) {
    const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', data.character_id).single();
    if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: data.character_id });
  }
  res.json(data);
});
// POST /api/inventory/container/take — достать предмет из контейнера
router.post('/container/take', authMiddleware, async (req, res) => {
  const { slot_id, child_slot_id, quantity } = req.body;

  const { data: childSlot } = await supabase.from('inventory_slots')
    .select('*, item:items(*)').eq('id', child_slot_id).single();
  if (!childSlot) return res.status(404).json({ error: 'Предмет не найден в контейнере' });

  const { data: parentSlot } = await supabase.from('inventory_slots')
    .select('*, item:items(*)').eq('id', slot_id).single();
  if (!parentSlot || parentSlot.item?.slot !== 'container') {
    return res.status(400).json({ error: 'Это не контейнер' });
  }

  const { data: ch } = await supabase.from('characters')
    .select('user_id, campaign_id').eq('id', parentSlot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const takeQty = Math.min(quantity || 1, childSlot.quantity || 1);

  // Добавляем предмет в рюкзак
  await supabase.from('inventory_slots').insert({
    character_id: parentSlot.character_id,
    item_id: childSlot.item_id,
    quantity: takeQty,
    slot_type: 'рюкзак',
    equipped: false,
    position: 0
  });

  // Уменьшаем/удаляем из контейнера
  const remaining = (childSlot.quantity || 1) - takeQty;
  if (remaining <= 0) {
    await supabase.from('inventory_slots').delete().eq('id', child_slot_id);
  } else {
    await supabase.from('inventory_slots').update({ quantity: remaining }).eq('id', child_slot_id);
  }

  if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: parentSlot.character_id });
  res.json({ success: true, taken: takeQty, remaining: Math.max(0, remaining) });
});

// POST /api/inventory/container/use — использовать предмет прямо из контейнера
router.post('/container/use', authMiddleware, async (req, res) => {
  const { slot_id, child_slot_id } = req.body;

  const { data: childSlot } = await supabase.from('inventory_slots')
    .select('*, item:items(*)').eq('id', child_slot_id).single();
  if (!childSlot) return res.status(404).json({ error: 'Предмет не найден в контейнере' });

  const { data: parentSlot } = await supabase.from('inventory_slots')
    .select('*, item:items(*)').eq('id', slot_id).single();
  if (!parentSlot || parentSlot.item?.slot !== 'container') {
    return res.status(400).json({ error: 'Это не контейнер' });
  }

  const { data: ch } = await supabase.from('characters')
    .select('user_id, name, campaign_id').eq('id', parentSlot.character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const item = childSlot.item;
  let result = null;

  // Можно использовать: расходники, патроны (для перезарядки)
  if (item.slot === 'consumable') {
    const nq = (childSlot.quantity || 1) - 1;
    if (nq <= 0) {
      await supabase.from('inventory_slots').delete().eq('id', child_slot_id);
      result = { used: 'consumable', deleted: true, action: 'использовал из контейнера' };
    } else {
      await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', child_slot_id);
      result = { used: 'consumable', remaining: nq, action: 'использовал из контейнера' };
    }
  } else if (item.slot === 'ammo') {
    // Найти экипированное оружие под этот тип патронов и перезарядить
    const { data: equipped } = await supabase.from('inventory_slots')
      .select('*, item:items(*)')
      .eq('character_id', parentSlot.character_id)
      .eq('equipped', true)
      .eq('item.slot', 'weapon')
      .eq('item.weapon_type', 'ranged')
      .eq('item.ammo_type_id', item.ammo_type_id)
      .single();

    if (!equipped) return res.status(400).json({ error: 'Нет подходящего оружия для этих патронов' });

    const maxAmmo = equipped.item.max_ammo || 0;
    const currentAmmo = equipped.item.current_ammo || 0;
    const needed = maxAmmo - currentAmmo;
    if (needed <= 0) return res.status(400).json({ error: 'Магазин уже полон' });

    const toReload = Math.min(needed, childSlot.quantity || 1);
    await supabase.from('items').update({ current_ammo: currentAmmo + toReload }).eq('id', equipped.item.id);

    const remaining = (childSlot.quantity || 1) - toReload;
    if (remaining <= 0) {
      await supabase.from('inventory_slots').delete().eq('id', child_slot_id);
    } else {
      await supabase.from('inventory_slots').update({ quantity: remaining }).eq('id', child_slot_id);
    }

    result = { used: 'ammo', reloaded: toReload, weapon: equipped.item.name, action: 'перезарядил из контейнера' };
  } else {
    return res.status(400).json({ error: 'Этот предмет нельзя использовать из контейнера' });
  }

  if (ch.campaign_id) {
    const msgText = `${ch.name} ${result.action} ${item.name}`;
    const { data: msg } = await supabase.from('chat_messages').insert({
      campaign_id: ch.campaign_id, user_id: req.user.id,
      username: ch.name, text: msgText, is_roll: false
    }).select().single();
    if (msg) notifyCampaign(ch.campaign_id, 'chat_message', msg);
    notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: parentSlot.character_id });
  }
  res.json(result);
});

export default router;

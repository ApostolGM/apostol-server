// routes/inventory.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/add', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity, slot_type } = req.body;
  const { data: ch } = await supabase
    .from('characters')
    .select('user_id')
    .eq('id', character_id)
    .single();
  if (!ch || ch.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Не ваш персонаж' });
  }

  const st = slot_type || 'рюкзак';
  const { data: existing } = await supabase
    .from('inventory_slots')
    .select('*')
    .eq('character_id', character_id)
    .eq('item_id', item_id)
    .eq('slot_type', st)
    .single();

  if (existing && !['правая_рука', 'левая_рука', 'тело', 'экзоскелет'].includes(st)) {
    const { data, error } = await supabase
      .from('inventory_slots')
      .update({ quantity: existing.quantity + (quantity || 1) })
      .eq('id', existing.id)
      .select('*, item:items(*)')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const { data, error } = await supabase
    .from('inventory_slots')
    .insert({
      character_id,
      item_id,
      quantity: quantity || 1,
      slot_type: st,
      equipped: false,
      position: 0,
    })
    .select('*, item:items(*)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/remove', authMiddleware, async (req, res) => {
  const { slot_id, quantity } = req.body;
  const { data: slot } = await supabase
    .from('inventory_slots')
    .select('*, item:items(*)')
    .eq('id', slot_id)
    .single();
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });

  const { data: ch } = await supabase
    .from('characters')
    .select('user_id')
    .eq('id', slot.character_id)
    .single();
  if (!ch || ch.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Не ваш персонаж' });
  }

  const nq = slot.quantity - (quantity || 1);
  if (nq <= 0) {
    await supabase.from('inventory_slots').delete().eq('id', slot_id);
    return res.json({ deleted: true });
  }
  const { data, error } = await supabase
    .from('inventory_slots')
    .update({ quantity: nq })
    .eq('id', slot_id)
    .select('*, item:items(*)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/equip', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase
    .from('inventory_slots')
    .select('*, item:items(*)')
    .eq('id', slot_id)
    .single();
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });

  const { data: ch } = await supabase
    .from('characters')
    .select('user_id')
    .eq('id', slot.character_id)
    .single();
  if (!ch || ch.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Не ваш персонаж' });
  }

  const item = slot.item;
  const cid = slot.character_id;

  if (item.is_weapon) {
    const { data: hands } = await supabase
      .from('inventory_slots')
      .select('*, item:items(*)')
      .eq('character_id', cid)
      .eq('equipped', true)
      .in('slot_type', ['правая_рука', 'левая_рука']);

    let usedSlots = 0;
    for (const h of hands) usedSlots += h.item?.is_heavy ? 2 : 1;
    const needed = item.is_heavy ? 2 : 1;
    if (usedSlots + needed > 2) {
      return res.status(400).json({ error: 'Не хватает слотов рук' });
    }

    if (item.is_heavy) {
      for (const h of hands) {
        await supabase
          .from('inventory_slots')
          .update({ equipped: false, slot_type: 'рюкзак' })
          .eq('id', h.id);
      }
      const { data, error } = await supabase
        .from('inventory_slots')
        .update({ equipped: true, slot_type: 'правая_рука' })
        .eq('id', slot_id)
        .select('*, item:items(*)')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    } else {
      const occupiedSlots = hands.map(h => h.slot_type);
      let target = 'правая_рука';
      if (occupiedSlots.includes('правая_рука') && !occupiedSlots.includes('левая_рука')) {
        target = 'левая_рука';
      } else if (occupiedSlots.includes('правая_рука') && occupiedSlots.includes('левая_рука')) {
        const left = hands.find(h => h.slot_type === 'левая_рука');
        if (left) {
          await supabase
            .from('inventory_slots')
            .update({ equipped: false, slot_type: 'рюкзак' })
            .eq('id', left.id);
        }
        target = 'левая_рука';
      } else if (occupiedSlots.includes('левая_рука') && !occupiedSlots.includes('правая_рука')) {
        target = 'правая_рука';
      }
      const { data, error } = await supabase
        .from('inventory_slots')
        .update({ equipped: true, slot_type: target })
        .eq('id', slot_id)
        .select('*, item:items(*)')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }
  }

  if (item.is_armor || item.type === 'броня') {
    await supabase
      .from('inventory_slots')
      .update({ equipped: false, slot_type: 'рюкзак' })
      .eq('character_id', cid)
      .eq('slot_type', 'тело')
      .neq('id', slot_id);
    const { data, error } = await supabase
      .from('inventory_slots')
      .update({ equipped: true, slot_type: 'тело' })
      .eq('id', slot_id)
      .select('*, item:items(*)')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (item.type === 'экзоскелет') {
    await supabase
      .from('inventory_slots')
      .update({ equipped: false, slot_type: 'рюкзак' })
      .eq('character_id', cid)
      .eq('slot_type', 'экзоскелет')
      .neq('id', slot_id);
    const { data, error } = await supabase
      .from('inventory_slots')
      .update({ equipped: true, slot_type: 'экзоскелет' })
      .eq('id', slot_id)
      .select('*, item:items(*)')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  res.status(400).json({ error: 'Нельзя экипировать этот предмет' });
});

router.post('/unequip', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase
    .from('inventory_slots')
    .select('*, item:items(*)')
    .eq('id', slot_id)
    .single();
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });

  const { data: ch } = await supabase
    .from('characters')
    .select('user_id')
    .eq('id', slot.character_id)
    .single();
  if (!ch || ch.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Не ваш персонаж' });
  }

  const { data, error } = await supabase
    .from('inventory_slots')
    .update({ equipped: false, slot_type: 'рюкзак' })
    .eq('id', slot_id)
    .select('*, item:items(*)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/use', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase
    .from('inventory_slots')
    .select('*, item:items(*)')
    .eq('id', slot_id)
    .single();
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });

  const { data: ch } = await supabase
    .from('characters')
    .select('user_id, name')
    .eq('id', slot.character_id)
    .single();
  if (!ch || ch.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Не ваш персонаж' });
  }

  const item = slot.item;
  let result = null;

  if (item.weapon_type === 'ranged' && slot.equipped) {
    if ((item.current_ammo || 0) <= 0) {
      return res.status(400).json({ error: 'Нет патронов' });
    }
    await supabase
      .from('items')
      .update({ current_ammo: (item.current_ammo || 1) - 1 })
      .eq('id', item.id);
    result = { used: 'ammo', remaining: (item.current_ammo || 1) - 1, action: 'выстрелил из' };
  } else if (item.weapon_type === 'thrown' && slot.equipped) {
    await supabase.from('inventory_slots').delete().eq('id', slot_id);
    result = { used: 'thrown', deleted: true, action: 'метнул' };
  } else if (item.type === 'расходник') {
    const nq = slot.quantity - 1;
    if (nq <= 0) {
      await supabase.from('inventory_slots').delete().eq('id', slot_id);
      result = { used: 'consumable', deleted: true, action: 'использовал' };
    } else {
      await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', slot_id);
      result = { used: 'consumable', remaining: nq, action: 'использовал' };
    }
  } else {
    return res.status(400).json({ error: 'Нельзя использовать этот предмет' });
  }

  const { data: charCampaign } = await supabase
    .from('characters')
    .select('campaign_id')
    .eq('id', slot.character_id)
    .single();

  if (charCampaign?.campaign_id) {
    const msgText = `${ch.name} ${result.action} ${item.name}`;
    const { data: msg } = await supabase
      .from('chat_messages')
      .insert({
        campaign_id: charCampaign.campaign_id,
        user_id: req.user.id,
        username: ch.name,
        text: msgText,
        is_roll: false,
      })
      .select()
      .single();
    if (msg) {
      req.app.get('io').to(`campaign:${charCampaign.campaign_id}`).emit('chat_message', msg);
    }
  }
  res.json(result);
});

router.post('/reload', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase
    .from('inventory_slots')
    .select('*, item:items(*)')
    .eq('id', slot_id)
    .single();

  if (!slot || !slot.item?.is_weapon || slot.item?.weapon_type !== 'ranged') {
    return res.status(400).json({ error: 'Не дальнобойное оружие' });
  }

  const { data: ch } = await supabase
    .from('characters')
    .select('user_id')
    .eq('id', slot.character_id)
    .single();
  if (!ch || ch.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Не ваш персонаж' });
  }

  const neededAmmoType = slot.item.ammo_type;
  if (!neededAmmoType) {
    return res.status(400).json({ error: 'Для этого оружия не указан тип патронов' });
  }

  const maxAmmo = slot.item.max_ammo || 0;
  const currentAmmo = slot.item.current_ammo || 0;
  const needed = maxAmmo - currentAmmo;
  if (needed <= 0) return res.status(400).json({ error: 'Магазин уже полон' });

  const { data: allSlots } = await supabase
    .from('inventory_slots')
    .select('*, item:items(*)')
    .eq('character_id', slot.character_id)
    .eq('equipped', false)
    .eq('item.trade_category', 'патроны');

  const ammoSlot = allSlots?.find(s => s.item?.ammo_type === neededAmmoType);
  if (!ammoSlot) {
    return res.status(400).json({ error: `Нет патронов типа "${neededAmmoType}"` });
  }

  const ammoAvailable = ammoSlot.quantity;
  const toReload = Math.min(needed, ammoAvailable);

  await supabase
    .from('items')
    .update({ current_ammo: currentAmmo + toReload })
    .eq('id', slot.item.id);

  const remaining = ammoAvailable - toReload;
  if (remaining <= 0) {
    await supabase.from('inventory_slots').delete().eq('id', ammoSlot.id);
  } else {
    await supabase.from('inventory_slots').update({ quantity: remaining }).eq('id', ammoSlot.id);
  }

  res.json({
    success: true,
    current_ammo: currentAmmo + toReload,
    max_ammo: maxAmmo,
    used: toReload,
    remaining_ammo_in_inventory: Math.max(0, remaining),
    ammo_type: neededAmmoType,
  });
});

export default router;

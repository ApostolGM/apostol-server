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
      let target = 'правая_рука

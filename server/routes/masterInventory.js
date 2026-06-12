// routes/masterInventory.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.put('/:slotId', authMiddleware, async (req, res) => {
  const { condition_percent, equipped, slot_type, quantity } = req.body;
  const updates = {};
  if (condition_percent !== undefined) updates.condition_percent = condition_percent;
  if (equipped !== undefined) updates.equipped = equipped;
  if (slot_type !== undefined) updates.slot_type = slot_type;
  if (quantity !== undefined) updates.quantity = quantity;

  const { data, error } = await supabase
    .from('inventory_slots')
    .update(updates)
    .eq('id', req.params.slotId)
    .select('*, item:items(*)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/add', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity, slot_type } = req.body;
  const st = slot_type || 'рюкзак';
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

router.post('/:slotId/mod', authMiddleware, async (req, res) => {
  const { mod_item_id } = req.body;
  const { data: slot } = await supabase
    .from('inventory_slots')
    .select('*, item:items(*)')
    .eq('id', req.params.slotId)
    .single();
  if (!slot) return res.status(404).json({ error: 'Предмет не найден' });

  const { data: modItem } = await supabase
    .from('items')
    .select('*')
    .eq('id', mod_item_id)
    .single();
  if (!modItem || modItem.type !== 'модификация') {
    return res.status(400).json({ error: 'Это не модификация' });
  }

  const mods = slot.mods || [];
  if (mods.find(m => m.id === modItem.id)) {
    return res.status(400).json({ error: 'Модификация уже установлена' });
  }

  mods.push({ id: modItem.id, name: modItem.name, description: modItem.description });
  const { data, error } = await supabase
    .from('inventory_slots')
    .update({ mods })
    .eq('id', req.params.slotId)
    .select('*, item:items(*)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:slotId/mod/:modItemId', authMiddleware, async (req, res) => {
  const { data: slot } = await supabase
    .from('inventory_slots')
    .select('*')
    .eq('id', req.params.slotId)
    .single();
  if (!slot) return res.status(404).json({ error: 'Предмет не найден' });

  const mods = (slot.mods || []).filter(m => m.id !== req.params.modItemId);
  const { data, error } = await supabase
    .from('inventory_slots')
    .update({ mods })
    .eq('id', req.params.slotId)
    .select('*, item:items(*)')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;

// routes/master.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// POST /api/master/inventory/add
router.post('/inventory/add', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity, slot_type } = req.body;
  const st = slot_type || 'рюкзак';

  const { data: item } = await supabase.from('items').select('*').eq('id', item_id).single();
  const { data, error } = await supabase.from('inventory_slots')
    .insert({ character_id, item_id, quantity: quantity || 1, slot_type: st, equipped: false, position: 0 })
    .select('*, item:items(*, ammo_type:ammo_types(*))').single();

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

  const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', character_id).single();
  if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id });
  res.json(data);
});

export default router;

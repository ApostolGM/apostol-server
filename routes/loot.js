// routes/loot.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// PUT /api/loot/:id
router.put('/:id', authMiddleware, async (req, res) => {
  const { name, items } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (items !== undefined) updates.items = items;
  const { data, error } = await supabase.from('loot_pools')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/loot/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  await supabase.from('loot_pools').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// POST /api/loot/:id/give/:characterId
router.post('/:id/give/:characterId', authMiddleware, async (req, res) => {
  const { data: pool } = await supabase.from('loot_pools').select('*').eq('id', req.params.id).single();
  if (!pool) return res.status(404).json({ error: 'Лут-пул не найден' });

  const { data: ch } = await supabase.from('characters').select('id, campaign_id').eq('id', req.params.characterId).single();
  if (!ch) return res.status(404).json({ error: 'Персонаж не найден' });

  const { data: charPerks } = await supabase.from('character_perks').select('perk_id').eq('character_id', ch.id);
  const { data: junkPerk } = charPerks?.length
    ? await supabase.from('perks').select('id').in('id', charPerks.map(p => p.perk_id)).eq('name', 'Мусорщик').single()
    : { data: null };

  let items = pool.items || [];
  let isJunkLoot = false;

  if (junkPerk) {
    isJunkLoot = true;
    if (items.length < 3) {
      const { data: randomItems } = await supabase.from('items').select('*').limit(3 - items.length);
      for (const ri of (randomItems || [])) {
        items.push({ item_id: ri.id, quantity: 1 });
      }
    }
  }

  for (const item of items) {
    await supabase.from('inventory_slots').insert({
      character_id: ch.id, item_id: item.item_id, quantity: item.quantity || 1,
      slot_type: 'рюкзак', equipped: false, is_junk: isJunkLoot
    });
  }

  if (ch.campaign_id) {
    notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: ch.id });
    const { data: charData } = await supabase.from('characters').select('name').eq('id', ch.id).single();
    const { data: msg } = await supabase.from('chat_messages').insert({
      campaign_id: ch.campaign_id, user_id: req.user.id, username: 'Мастер',
      text: `${charData?.name} получил лут: ${items.length} предметов${isJunkLoot ? ' (Мусор)' : ''}`,
      is_roll: false
    }).select().single();
    if (msg) notifyCampaign(ch.campaign_id, 'chat_message', msg);
  }

  res.json({ success: true, items_count: items.length, is_junk: isJunkLoot });
});

export default router;

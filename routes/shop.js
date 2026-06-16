// routes/shop.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, adminMiddleware } from '../middleware.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// GET /api/shop
router.get('/', authMiddleware, async (req, res) => {
  const { data: presets } = await supabase.from('shop_presets').select('*').eq('is_active', true);
  const items = [];
  for (const p of (presets || [])) {
    for (const i of (p.items || [])) {
      const { data: item } = await supabase.from('items').select('*, ammo_type:ammo_types(*)').eq('id', i.item_id).single();
      if (item) items.push({ ...item, shop_price: i.price_override || item.trade_price, preset_name: p.name });
    }
  }
  res.json(items);
});

// GET /api/shop/presets
router.get('/presets', authMiddleware, adminMiddleware, async (req, res) => {
  const { data } = await supabase.from('shop_presets').select('*').order('name');
  res.json(data || []);
});

// POST /api/shop/presets
router.post('/presets', authMiddleware, adminMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('shop_presets').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT /api/shop/presets/:id
router.put('/presets/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('shop_presets')
    .update({ ...req.body, updated_at: new Date() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/shop/presets/:id
router.delete('/presets/:id', authMiddleware, adminMiddleware, async (req, res) => {
  await supabase.from('shop_presets').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// POST /api/shop/buy
router.post('/buy', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity } = req.body;

  const { data: ch } = await supabase.from('characters')
    .select('user_id, campaign_id, currency').eq('id', character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });

  const { data: item } = await supabase.from('items').select('*, ammo_type:ammo_types(*)').eq('id', item_id).single();
  if (!item) return res.status(404).json({ error: 'Предмет не найден' });

  const { data: presets } = await supabase.from('shop_presets').select('*').eq('is_active', true);
  let price = item.trade_price;
  for (const p of (presets || [])) {
    const pi = (p.items || []).find(i => i.item_id === item_id);
    if (pi) { price = pi.price_override || item.trade_price; break; }
  }

  const totalPrice = price * (quantity || 1);
  if ((ch.currency || 0) < totalPrice) {
    return res.status(400).json({ error: `Недостаточно средств. Нужно ${totalPrice}, у вас ${ch.currency || 0}` });
  }

  await supabase.from('characters').update({ currency: (ch.currency || 0) - totalPrice }).eq('id', character_id);

  const { data, error } = await supabase.from('inventory_slots')
    .insert({ character_id, item_id, quantity: quantity || 1, slot_type: 'рюкзак', equipped: false })
    .select('*, item:items(*, ammo_type:ammo_types(*))').single();

  if (error) return res.status(500).json({ error: error.message });
  if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id });

  res.json({ success: true, item: data, price: totalPrice, new_balance: (ch.currency || 0) - totalPrice });
});

export default router;

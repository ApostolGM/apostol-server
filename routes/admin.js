// routes/admin.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, adminMiddleware, validate, schemas } from '../middleware.js';

const router = Router();

// Все роуты требуют adminMiddleware
router.use(authMiddleware, adminMiddleware);

// ===== ITEMS =====
router.get('/items', async (req, res) => {
  const { data } = await supabase.from('items').select('*, ammo_type:ammo_types(*)').order('name');
  res.json(data || []);
});

router.post('/items', validate(schemas.createItem), async (req, res) => {
  const { data: item, error } = await supabase.from('items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });

  if (item.slot === 'weapon' && item.weapon_type === 'ranged' && item.ammo_type_id) {
    const { data: ammoType } = await supabase.from('ammo_types').select('name').eq('id', item.ammo_type_id).single();
    if (ammoType) {
      await supabase.from('items').insert({
        name: `${ammoType.name} для ${item.name}`,
        slot: 'ammo', weight: 0.1, trade_price: 10,
        ammo_type_id: item.ammo_type_id, is_global: true
      });
    }
  }
  res.json(item);
});

router.put('/items/:id', async (req, res) => {
  const { data, error } = await supabase.from('items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/items/:id', async (req, res) => {
  await supabase.from('items').delete().eq('id', req.params.id);
  res.json({ success: true });
});

router.post('/items/batch-delete', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ error: 'ids обязателен' });
  await supabase.from('items').delete().in('id', ids);
  res.json({ success: true });
});

router.put('/items/batch-price', async (req, res) => {
  const { ids, trade_price } = req.body;
  if (!ids?.length || trade_price === undefined) return res.status(400).json({ error: 'ids и trade_price обязательны' });
  await supabase.from('items').update({ trade_price }).in('id', ids);
  res.json({ success: true });
});

// ===== PERKS =====
router.get('/perks', async (req, res) => {
  const { data } = await supabase.from('perks').select('*').order('name');
  res.json(data || []);
});

router.post('/perks', async (req, res) => {
  const { data, error } = await supabase.from('perks').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/perks/:id', async (req, res) => {
  const { data, error } = await supabase.from('perks').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/perks/:id', async (req, res) => {
  await supabase.from('perks').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== PROFESSIONS =====
router.get('/professions', async (req, res) => {
  const { data } = await supabase.from('professions').select('*').order('name');
  res.json(data || []);
});

router.post('/professions', async (req, res) => {
  const { data, error } = await supabase.from('professions').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/professions/:id', async (req, res) => {
  const { data, error } = await supabase.from('professions').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/professions/:id', async (req, res) => {
  await supabase.from('professions').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== SKILLS =====
router.get('/skills', async (req, res) => {
  const { data } = await supabase.from('skills').select('*, characteristic:characteristics(*)').order('name');
  res.json(data || []);
});

router.post('/skills', async (req, res) => {
  const { name, characteristic_id } = req.body;
  const { data, error } = await supabase.from('skills')
    .insert({ name, characteristic_id, is_global: true })
    .select('*, characteristic:characteristics(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/skills/:id', async (req, res) => {
  const { data, error } = await supabase.from('skills').update(req.body).eq('id', req.params.id)
    .select('*, characteristic:characteristics(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/skills/:id', async (req, res) => {
  await supabase.from('skills').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== USERS =====
router.get('/users', async (req, res) => {
  const { data } = await supabase.from('users')
    .select('id, username, role, created_at').order('created_at', { ascending: false });
  res.json(data || []);
});

router.put('/users/:id', async (req, res) => {
  const { role } = req.body;
  if (req.user.id === req.params.id && role !== 'admin') {
    return res.status(400).json({ error: 'Нельзя снять админа с себя' });
  }
  const { data, error } = await supabase.from('users')
    .update({ role }).eq('id', req.params.id).select('id, username, role').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/users/:id', async (req, res) => {
  if (req.user.id === req.params.id) return res.status(400).json({ error: 'Нельзя удалить себя' });

  const { data: chars } = await supabase.from('characters').select('id').eq('user_id', req.params.id);
  for (const c of (chars || [])) {
    await supabase.from('inventory_slots').delete().eq('character_id', c.id);
    await supabase.from('character_skills').delete().eq('character_id', c.id);
    await supabase.from('character_perks').delete().eq('character_id', c.id);
    await supabase.from('characters').delete().eq('id', c.id);
  }
  await supabase.from('campaign_members').delete().eq('user_id', req.params.id);
  await supabase.from('users').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== BACKGROUNDS =====
router.get('/backgrounds', async (req, res) => {
  const { data } = await supabase.from('backgrounds').select('*').eq('is_global', true).order('name');
  res.json(data || []);
});

router.delete('/backgrounds/:id', async (req, res) => {
  await supabase.from('backgrounds').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== SOUNDS =====
router.get('/sounds', async (req, res) => {
  const { data } = await supabase.from('sounds').select('*').eq('is_global', true).order('name');
  res.json(data || []);
});

router.delete('/sounds/:id', async (req, res) => {
  await supabase.from('sounds').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== CAMPAIGNS =====
router.get('/campaigns', async (req, res) => {
  const { data } = await supabase.from('campaigns')
    .select('*, master:users(username)').order('created_at', { ascending: false });
  res.json(data || []);
});

router.delete('/campaigns/:id', async (req, res) => {
  await supabase.from('campaigns').delete().eq('id', req.params.id);
  res.json({ success: true });
});

export default router;

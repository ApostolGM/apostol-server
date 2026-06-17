// routes/admin.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, adminMiddleware, validate, schemas } from '../middleware.js';

const router = Router();
router.use(authMiddleware, adminMiddleware);

// ===== ITEMS =====
router.get('/items', async (req, res) => {
  const { data } = await supabase.from('items')
    .select('*, ammo_type:ammo_types(*), item_slot:item_slots(*)').order('name');
  res.json(data || []);
});

router.post('/items', validate(schemas.createItem), async (req, res) => {
  const { data: item, error } = await supabase.from('items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Автосоздание патронов для дальнего оружия
  if (item.item_slot_id) {
    const { data: slot } = await supabase.from('item_slots').select('name').eq('id', item.item_slot_id).single();
    if (slot?.name === 'weapon' && item.weapon_type === 'ranged' && item.ammo_type_id) {
      const { data: ammoType } = await supabase.from('ammo_types').select('name').eq('id', item.ammo_type_id).single();
      if (ammoType) {
        await supabase.from('items').insert({
          name: `${ammoType.name} для ${item.name}`,
          slot: 'ammo', weight: 0.1, trade_price: 10,
          ammo_type_id: item.ammo_type_id, is_global: true
        });
      }
    }
  }
  res.json(item);
});

router.put('/items/:id', async (req, res) => {
  const { data } = await supabase.from('items').update(req.body).eq('id', req.params.id).select().single();
  res.json(data);
});

router.delete('/items/:id', async (req, res) => {
  await supabase.from('items').delete().eq('id', req.params.id);
  res.json({ success: true });
});

router.post('/items/batch-delete', async (req, res) => {
  const { ids } = req.body;
  await supabase.from('items').delete().in('id', ids);
  res.json({ success: true });
});

router.put('/items/batch-price', async (req, res) => {
  const { ids, trade_price } = req.body;
  await supabase.from('items').update({ trade_price }).in('id', ids);
  res.json({ success: true });
});

// ===== PERKS =====
router.get('/perks', async (req, res) => {
  const { data } = await supabase.from('perks').select('*').order('name');
  res.json(data || []);
});

router.post('/perks', async (req, res) => {
  const { data } = await supabase.from('perks').insert(req.body).select().single();
  res.json(data);
});

router.put('/perks/:id', async (req, res) => {
  const { data } = await supabase.from('perks').update(req.body).eq('id', req.params.id).select().single();
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
  const { data } = await supabase.from('professions').insert(req.body).select().single();
  res.json(data);
});

router.put('/professions/:id', async (req, res) => {
  const { data } = await supabase.from('professions').update(req.body).eq('id', req.params.id).select().single();
  res.json(data);
});

router.delete('/professions/:id', async (req, res) => {
  await supabase.from('professions').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== SKILLS =====
router.get('/skills', async (req, res) => {
  const { data } = await supabase.from('skills')
    .select('*, characteristic:characteristics(*), parent:skills(name)').order('name');
  res.json(data || []);
});

router.post('/skills', async (req, res) => {
  const { data } = await supabase.from('skills').insert(req.body)
    .select('*, characteristic:characteristics(*)').single();
  res.json(data);
});

router.put('/skills/:id', async (req, res) => {
  const { data } = await supabase.from('skills').update(req.body).eq('id', req.params.id)
    .select('*, characteristic:characteristics(*)').single();
  res.json(data);
});

router.delete('/skills/:id', async (req, res) => {
  await supabase.from('skills').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== SKILL LINKS =====
router.get('/skill-links', async (req, res) => {
  const { data } = await supabase.from('skill_links')
    .select('*, parent:skills(name), child:skills(name)').order('parent_skill_id');
  res.json(data || []);
});

router.post('/skill-links', async (req, res) => {
  const { parent_skill_id, child_skill_id, coefficient } = req.body;
  const { data } = await supabase.from('skill_links').insert({
    parent_skill_id, child_skill_id, coefficient: coefficient || 1.0
  }).select().single();
  res.json(data);
});

router.delete('/skill-links/:id', async (req, res) => {
  await supabase.from('skill_links').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== ITEM SLOTS =====
router.get('/item-slots', async (req, res) => {
  const { data } = await supabase.from('item_slots').select('*').order('name');
  res.json(data || []);
});

router.post('/item-slots', async (req, res) => {
  const { name, description } = req.body;
  const { data } = await supabase.from('item_slots').insert({ name, description }).select().single();
  res.json(data);
});

router.delete('/item-slots/:id', async (req, res) => {
  await supabase.from('item_slots').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== INVENTORY CELLS =====
router.get('/inventory-cells', async (req, res) => {
  const { data } = await supabase.from('inventory_cells')
    .select('*, item_slot:item_slots(*)').order('sort_order');
  res.json(data || []);
});

router.post('/inventory-cells', async (req, res) => {
  const { name, slot_type, item_slot_id, max_items, sort_order } = req.body;
  const { data } = await supabase.from('inventory_cells').insert({
    name, slot_type: slot_type || 'equipment', item_slot_id, max_items: max_items || 1, sort_order: sort_order || 0
  }).select().single();
  res.json(data);
});

router.put('/inventory-cells/:id', async (req, res) => {
  const { data } = await supabase.from('inventory_cells').update(req.body).eq('id', req.params.id).select().single();
  res.json(data);
});

router.delete('/inventory-cells/:id', async (req, res) => {
  await supabase.from('inventory_cells').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== CHARACTER STATUSES =====
router.get('/character-statuses', async (req, res) => {
  const { data } = await supabase.from('character_statuses').select('*').order('sort_order');
  res.json(data || []);
});

router.post('/character-statuses', async (req, res) => {
  const { name, icon, default_value, min_value, max_value, sort_order } = req.body;
  const { data } = await supabase.from('character_statuses').insert({
    name, icon, default_value: default_value || 100, min_value: min_value || 0,
    max_value: max_value || 100, sort_order: sort_order || 0
  }).select().single();
  res.json(data);
});

router.delete('/character-statuses/:id', async (req, res) => {
  await supabase.from('character_statuses').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== CRAFT STATIONS =====
router.get('/craft-stations', async (req, res) => {
  const { data } = await supabase.from('craft_stations').select('*, item:items(*)').order('name');
  res.json(data || []);
});

router.post('/craft-stations', async (req, res) => {
  const { name, item_id, campaign_id, is_global } = req.body;
  const { data } = await supabase.from('craft_stations').insert({
    name, item_id, campaign_id: is_global ? null : campaign_id, is_global: is_global || false
  }).select().single();
  res.json(data);
});

router.delete('/craft-stations/:id', async (req, res) => {
  await supabase.from('craft_stations').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== CRAFT RECIPES =====
router.get('/craft-recipes', async (req, res) => {
  const { data } = await supabase.from('craft_recipes')
    .select('*, skill:skills(name), station:craft_stations(name), result_item:items(name), ingredients:craft_ingredients(*, item:items(name, icon))')
    .order('name');
  res.json(data || []);
});

router.post('/craft-recipes', async (req, res) => {
  const { name, description, skill_id, difficulty, station_required_id, result_item_id, result_quantity, ingredients, is_global } = req.body;
  const { data: recipe } = await supabase.from('craft_recipes').insert({
    name, description, skill_id, difficulty: difficulty || 0,
    station_required_id, result_item_id, result_quantity: result_quantity || 1,
    is_global: is_global !== undefined ? is_global : true
  }).select().single();

  if (ingredients?.length) {
    const ingData = ingredients.map(ing => ({
      recipe_id: recipe.id, item_id: ing.item_id,
      quantity: ing.quantity || 1, consumed_on_fail: ing.consumed_on_fail !== false
    }));
    await supabase.from('craft_ingredients').insert(ingData);
  }

  const { data: full } = await supabase.from('craft_recipes')
    .select('*, skill:skills(name), station:craft_stations(name), result_item:items(name), ingredients:craft_ingredients(*, item:items(name, icon))')
    .eq('id', recipe.id).single();
  res.json(full);
});

router.put('/craft-recipes/:id', async (req, res) => {
  const { ingredients, ...updates } = req.body;
  await supabase.from('craft_recipes').update(updates).eq('id', req.params.id);

  if (ingredients) {
    await supabase.from('craft_ingredients').delete().eq('recipe_id', req.params.id);
    const ingData = ingredients.map(ing => ({
      recipe_id: req.params.id, item_id: ing.item_id,
      quantity: ing.quantity || 1, consumed_on_fail: ing.consumed_on_fail !== false
    }));
    await supabase.from('craft_ingredients').insert(ingData);
  }

  const { data } = await supabase.from('craft_recipes')
    .select('*, skill:skills(name), station:craft_stations(name), result_item:items(name), ingredients:craft_ingredients(*, item:items(name, icon))')
    .eq('id', req.params.id).single();
  res.json(data);
});

router.delete('/craft-recipes/:id', async (req, res) => {
  await supabase.from('craft_recipes').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ===== USERS =====
router.get('/users', async (req, res) => {
  const { data } = await supabase.from('users').select('id, username, role, created_at').order('created_at', { ascending: false });
  res.json(data || []);
});

router.put('/users/:id', async (req, res) => {
  const { role } = req.body;
  if (req.user.id === req.params.id && role !== 'admin') return res.status(400).json({ error: 'Нельзя снять админа с себя' });
  const { data } = await supabase.from('users').update({ role }).eq('id', req.params.id).select('id, username, role').single();
  res.json(data);
});

router.delete('/users/:id', async (req, res) => {
  if (req.user.id === req.params.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
  const { data: chars } = await supabase.from('characters').select('id').eq('user_id', req.params.id);
  for (const c of (chars || [])) {
    await supabase.from('character_status_values').delete().eq('character_id', c.id);
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

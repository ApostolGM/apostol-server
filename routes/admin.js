// routes/admin.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, adminMiddleware, validate, schemas } from '../middleware.js';
import { notifyCampaign } from '../socket.js';

const router = Router();
router.use(authMiddleware, adminMiddleware);

// ===== ITEMS =====
router.get('/items', async (req, res) => {
  try {
    const { data } = await supabase.from('items')
      .select('*, ammo_type:ammo_types(*), item_slot:item_slots!items_item_slot_id_fkey(*), icon_data:icons!items_icon_id_fkey(*)')
      .order('name');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/items ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/items', validate(schemas.createItem), async (req, res) => {
  try {
    const { data: item, error } = await supabase.from('items').insert(req.body).select().single();
    if (error) {
      console.error('INSERT ITEM ERROR:', error);
      return res.status(500).json({ error: error.message });
    }
    if (item.item_slot_id) {
      const { data: slot } = await supabase.from('item_slots').select('name').eq('id', item.item_slot_id).single();
      if (slot?.name === 'weapon' && item.weapon_type === 'ranged' && item.ammo_type_id) {
        const { data: ammoType } = await supabase.from('ammo_types').select('name').eq('id', item.ammo_type_id).single();
        if (ammoType) {
          await supabase.from('items').insert({
            name: `${ammoType.name} для ${item.name}`,
            weight: 0.1, trade_price: 10,
            ammo_type_id: item.ammo_type_id, is_global: true
          });
        }
      }
    }
    res.json(item);
  } catch (err) {
    console.error('POST /admin/items ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/items/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.icon_id === '') updates.icon_id = null;

    const { data: item } = await supabase.from('items')
      .update(updates).eq('id', req.params.id)
      .select('*, ammo_type:ammo_types(*), item_slot:item_slots!items_item_slot_id_fkey(*), icon_data:icons!items_icon_id_fkey(*)').single();

    if (item?.is_dynamic) {
      const { data: slots } = await supabase.from('inventory_slots')
        .select('id, character_id').eq('item_id', req.params.id);
      const notifiedCampaigns = new Set();
      for (const slot of (slots || [])) {
        const { data: ch } = await supabase.from('characters')
          .select('campaign_id').eq('id', slot.character_id).single();
        if (ch?.campaign_id && !notifiedCampaigns.has(ch.campaign_id)) {
          notifyCampaign(ch.campaign_id, 'item_updated', {
            item_id: req.params.id,
            updates: { name: item.name, description: item.description, weight: item.weight, icon_id: item.icon_id }
          });
          notifiedCampaigns.add(ch.campaign_id);
        }
      }
    }

    res.json(item);
  } catch (err) {
    console.error('PUT /admin/items/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/items/:id', async (req, res) => {
  try {
    await supabase.from('items').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/items/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/items/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    await supabase.from('items').delete().in('id', ids);
    res.json({ success: true });
  } catch (err) {
    console.error('BATCH DELETE ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/items/batch-price', async (req, res) => {
  try {
    const { ids, trade_price } = req.body;
    await supabase.from('items').update({ trade_price }).in('id', ids);
    res.json({ success: true });
  } catch (err) {
    console.error('BATCH PRICE ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== PERKS =====
router.get('/perks', async (req, res) => {
  try {
    const { data } = await supabase.from('perks').select('*').order('name');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/perks ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/perks', async (req, res) => {
  try {
    const { data } = await supabase.from('perks').insert(req.body).select().single();
    res.json(data);
  } catch (err) {
    console.error('POST /admin/perks ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/perks/:id', async (req, res) => {
  try {
    const { data } = await supabase.from('perks').update(req.body).eq('id', req.params.id).select().single();
    res.json(data);
  } catch (err) {
    console.error('PUT /admin/perks/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/perks/:id', async (req, res) => {
  try {
    await supabase.from('perks').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/perks/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== PROFESSIONS =====
router.get('/professions', async (req, res) => {
  try {
    const { data } = await supabase.from('professions').select('*').order('name');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/professions ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/professions', async (req, res) => {
  try {
    const { data } = await supabase.from('professions').insert(req.body).select().single();
    res.json(data);
  } catch (err) {
    console.error('POST /admin/professions ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/professions/:id', async (req, res) => {
  try {
    const { data } = await supabase.from('professions').update(req.body).eq('id', req.params.id).select().single();
    res.json(data);
  } catch (err) {
    console.error('PUT /admin/professions/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/professions/:id', async (req, res) => {
  try {
    await supabase.from('professions').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/professions/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== SKILLS =====
router.get('/skills', async (req, res) => {
  try {
    const { data } = await supabase.from('skills')
     .select('*, characteristic:characteristics(*)')
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/skills ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/skills', async (req, res) => {
  try {
    const { data } = await supabase.from('skills').insert(req.body)
      .select('*, characteristic:characteristics(*)').single();
    res.json(data);
  } catch (err) {
    console.error('POST /admin/skills ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/skills/:id', async (req, res) => {
  try {
    const { data } = await supabase.from('skills').update(req.body).eq('id', req.params.id)
      .select('*, characteristic:characteristics(*)').single();
    res.json(data);
  } catch (err) {
    console.error('PUT /admin/skills/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/skills/:id', async (req, res) => {
  try {
    await supabase.from('skills').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/skills/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== SKILL LINKS =====
router.get('/skill-links', async (req, res) => {
  try {
    const { data } = await supabase.from('skill_links')
      .select('*, parent:skills!skill_links_parent_skill_id_fkey(name), child:skills!skill_links_child_skill_id_fkey(name)')
      .order('parent_skill_id');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/skill-links ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/skill-links', async (req, res) => {
  try {
    const { parent_skill_id, child_skill_id, coefficient } = req.body;
    const { data } = await supabase.from('skill_links').insert({
      parent_skill_id, child_skill_id, coefficient: coefficient || 1.0
    }).select().single();
    res.json(data);
  } catch (err) {
    console.error('POST /admin/skill-links ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/skill-links/:id', async (req, res) => {
  try {
    await supabase.from('skill_links').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/skill-links/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== ITEM SLOTS =====
router.get('/item-slots', async (req, res) => {
  try {
    const { data } = await supabase.from('item_slots').select('*').order('name');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/item-slots ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/item-slots', async (req, res) => {
  try {
    const { name, description } = req.body;
    const { data } = await supabase.from('item_slots').insert({ name, description }).select().single();
    res.json(data);
  } catch (err) {
    console.error('POST /admin/item-slots ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/item-slots/:id', async (req, res) => {
  try {
    await supabase.from('item_slots').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/item-slots/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== INVENTORY CELLS =====
router.get('/inventory-cells', async (req, res) => {
  try {
    const { data } = await supabase.from('inventory_cells')
      .select('*, item_slot:item_slots!inventory_cells_item_slot_id_fkey(*)').order('sort_order');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/inventory-cells ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/inventory-cells', async (req, res) => {
  try {
    const { name, slot_type, item_slot_id, max_items, sort_order } = req.body;
    const { data } = await supabase.from('inventory_cells').insert({
      name, slot_type: slot_type || 'equipment', item_slot_id, max_items: max_items || 1, sort_order: sort_order || 0
    }).select().single();
    res.json(data);
  } catch (err) {
    console.error('POST /admin/inventory-cells ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/inventory-cells/:id', async (req, res) => {
  try {
    const { data } = await supabase.from('inventory_cells').update(req.body).eq('id', req.params.id).select().single();
    res.json(data);
  } catch (err) {
    console.error('PUT /admin/inventory-cells/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/inventory-cells/:id', async (req, res) => {
  try {
    await supabase.from('inventory_cells').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/inventory-cells/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== CHARACTER STATUSES =====
router.get('/character-statuses', async (req, res) => {
  try {
    const { data } = await supabase.from('character_statuses').select('*').order('sort_order');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/character-statuses ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/character-statuses', async (req, res) => {
  try {
    const { name, icon, default_value, min_value, max_value, sort_order } = req.body;
    const { data } = await supabase.from('character_statuses').insert({
      name, icon, default_value: default_value || 100, min_value: min_value || 0,
      max_value: max_value || 100, sort_order: sort_order || 0
    }).select().single();
    res.json(data);
  } catch (err) {
    console.error('POST /admin/character-statuses ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/character-statuses/:id', async (req, res) => {
  try {
    await supabase.from('character_statuses').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/character-statuses/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== CRAFT STATIONS =====
router.get('/craft-stations', async (req, res) => {
  try {
    const { data } = await supabase.from('craft_stations').select('*, item:items(name)').order('name');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/craft-stations ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/craft-stations', async (req, res) => {
  try {
    const { name, item_id, campaign_id, is_global } = req.body;
    const { data } = await supabase.from('craft_stations').insert({
      name, item_id, campaign_id: is_global ? null : campaign_id, is_global: is_global || false
    }).select().single();
    res.json(data);
  } catch (err) {
    console.error('POST /admin/craft-stations ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/craft-stations/:id', async (req, res) => {
  try {
    await supabase.from('craft_stations').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/craft-stations/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== CRAFT RECIPES =====
router.get('/craft-recipes', async (req, res) => {
  try {
    const { data } = await supabase.from('craft_recipes')
      .select('*, skill:skills(name), station:craft_stations(name), result_item:items(name), ingredients:craft_ingredients(*, item:items(name, icon_id))')
      .order('name');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/craft-recipes ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/craft-recipes', async (req, res) => {
  try {
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
      .select('*, skill:skills(name), station:craft_stations(name), result_item:items(name), ingredients:craft_ingredients(*, item:items(name, icon_id))')
      .eq('id', recipe.id).single();
    res.json(full);
  } catch (err) {
    console.error('POST /admin/craft-recipes ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/craft-recipes/:id', async (req, res) => {
  try {
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
      .select('*, skill:skills(name), station:craft_stations(name), result_item:items(name), ingredients:craft_ingredients(*, item:items(name, icon_id))')
      .eq('id', req.params.id).single();
    res.json(data);
  } catch (err) {
    console.error('PUT /admin/craft-recipes/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/craft-recipes/:id', async (req, res) => {
  try {
    await supabase.from('craft_recipes').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/craft-recipes/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== ICONS =====
router.get('/icons', async (req, res) => {
  try {
    const { data } = await supabase.from('icons').select('*').order('category').order('name');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/icons ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/icons', async (req, res) => {
  try {
    const { name, url, category } = req.body;
    const { data } = await supabase.from('icons').insert({
      name, url, category: category || 'general'
    }).select().single();
    res.json(data);
  } catch (err) {
    console.error('POST /admin/icons ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/icons/:id', async (req, res) => {
  try {
    await supabase.from('icons').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/icons/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== USERS =====
router.get('/users', async (req, res) => {
  try {
    const { data } = await supabase.from('users').select('id, username, role, created_at').order('created_at', { ascending: false });
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/users ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { role } = req.body;
    if (req.user.id === req.params.id && role !== 'admin') return res.status(400).json({ error: 'Нельзя снять админа с себя' });
    const { data } = await supabase.from('users').update({ role }).eq('id', req.params.id).select('id, username, role').single();
    res.json(data);
  } catch (err) {
    console.error('PUT /admin/users/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
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
  } catch (err) {
    console.error('DELETE /admin/users/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== BACKGROUNDS =====
router.get('/backgrounds', async (req, res) => {
  try {
    const { data } = await supabase.from('backgrounds').select('*').eq('is_global', true).order('name');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/backgrounds ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/backgrounds/:id', async (req, res) => {
  try {
    await supabase.from('backgrounds').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/backgrounds/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== SOUNDS =====
router.get('/sounds', async (req, res) => {
  try {
    const { data } = await supabase.from('sounds').select('*').eq('is_global', true).order('name');
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/sounds ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sounds/:id', async (req, res) => {
  try {
    await supabase.from('sounds').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/sounds/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== CAMPAIGNS =====
router.get('/campaigns', async (req, res) => {
  try {
    const { data } = await supabase.from('campaigns')
      .select('*, master:users(username)').order('created_at', { ascending: false });
    res.json(data || []);
  } catch (err) {
    console.error('GET /admin/campaigns ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/campaigns/:id', async (req, res) => {
  try {
    await supabase.from('campaigns').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/campaigns/:id ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const JWT_SECRET = process.env.JWT_SECRET;

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Нет токена' });
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Токен недействителен' }); }
}

const activeUsers = new Map();

io.on('connection', (socket) => {
  socket.on('join_campaign', ({ userId, campaignId }) => {
    socket.join(`campaign:${campaignId}`);
    activeUsers.set(userId, { socketId: socket.id, campaignId });
  });
  socket.on('leave_campaign', ({ userId }) => {
    const u = activeUsers.get(userId);
    if (u) { socket.leave(`campaign:${u.campaignId}`); activeUsers.delete(userId); }
  });
  socket.on('dice_roll', (data) => {
    const payload = { ...data, time: new Date().toISOString() };
    if (data.hidden) {
      const room = io.sockets.adapter.rooms.get(`campaign:${data.campaignId}`);
      if (room) for (const sid of room) {
        const s = io.sockets.sockets.get(sid);
        if (s?.data?.role && ['master','co-master'].includes(s.data.role)) s.emit('dice_result', payload);
      }
      socket.emit('dice_result', payload);
    } else io.to(`campaign:${data.campaignId}`).emit('dice_result', payload);
  });
  socket.on('scene_token_move', (data) => {
    socket.to(`campaign:${data.campaignId}`).emit('scene_token_moved', data);
  });
  socket.on('scene_update', (data) => {
    socket.to(`campaign:${data.campaignId}`).emit('scene_updated', data);
  });
  socket.on('scene_draw', (data) => {
    socket.to(`campaign:${data.campaignId}`).emit('scene_drawn', data);
  });
  socket.on('set_role', (role) => { socket.data.role = role; });
  socket.on('disconnect', () => {
    for (const [uid, d] of activeUsers.entries()) if (d.socketId === socket.id) { activeUsers.delete(uid); break; }
  });
});

// ===== AUTH =====
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
  const { data: ex } = await supabase.from('users').select('id').eq('username', username).single();
  if (ex) return res.status(409).json({ error: 'Пользователь уже существует' });
  const hash = await bcrypt.hash(password, 10);
  const { data: user, error } = await supabase.from('users').insert({ username, password_hash: hash }).select('id, username, avatar_url').single();
  if (error) return res.status(500).json({ error: error.message });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ user, token });
});
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if (!user || !await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ user: { id: user.id, username: user.username, avatar_url: user.avatar_url }, token });
});
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const { data: user } = await supabase.from('users').select('id, username, avatar_url').eq('id', req.user.id).single();
  res.json(user);
});

// ===== CAMPAIGNS =====
app.post('/api/campaigns', authMiddleware, async (req, res) => {
  const { title } = req.body;
  const invite_code = uuidv4().substring(0, 8);
  const { data: c, error } = await supabase.from('campaigns').insert({ title, master_id: req.user.id, invite_code }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('campaign_members').insert({ campaign_id: c.id, user_id: req.user.id, role: 'master' });
  await supabase.from('scenes').insert({ campaign_id: c.id, scene_type: 'local' });
  await supabase.from('scenes').insert({ campaign_id: c.id, scene_type: 'global' });
  res.json(c);
});
app.post('/api/campaigns/join/:code', authMiddleware, async (req, res) => {
  const { data: c } = await supabase.from('campaigns').select('*').eq('invite_code', req.params.code).single();
  if (!c) return res.status(404).json({ error: 'Не найдена' });
  const { data: ex } = await supabase.from('campaign_members').select('id').eq('campaign_id', c.id).eq('user_id', req.user.id).single();
  if (ex) return res.status(409).json({ error: 'Вы уже в кампании' });
  await supabase.from('campaign_members').insert({ campaign_id: c.id, user_id: req.user.id, role: 'player' });
  res.json(c);
});
app.get('/api/campaigns', authMiddleware, async (req, res) => {
  const { data: m } = await supabase.from('campaign_members').select('campaign_id').eq('user_id', req.user.id);
  if (!m?.length) return res.json([]);
  const { data } = await supabase.from('campaigns').select('*').in('id', m.map(x => x.campaign_id));
  res.json(data);
});
app.get('/api/campaigns/:id', authMiddleware, async (req, res) => {
  const { data: c } = await supabase.from('campaigns').select('*').eq('id', req.params.id).single();
  if (!c) return res.status(404).json({ error: 'Не найдена' });
  const { data: members } = await supabase.from('campaign_members').select('user_id, role, character_id').eq('campaign_id', c.id);
  res.json({ ...c, members });
});

// ===== PROFESSIONS / PERKS / SKILLS =====
app.get('/api/professions', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('professions').select('*').eq('is_global', true);
  res.json(data);
});
app.get('/api/perks', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('perks').select('*').eq('is_global', true);
  res.json(data);
});
app.get('/api/skills', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('skills').select('*').eq('is_global', true);
  res.json(data);
});

// ===== CHARACTERS =====
app.post('/api/characters', authMiddleware, async (req, res) => {
  const { campaign_id, name, profession_id, perk_ids } = req.body;
  const { data: prof } = await supabase.from('professions').select('*').eq('id', profession_id).single();
  if (!prof) return res.status(400).json({ error: 'Профессия не найдена' });
  let bp = 10;
  if (perk_ids?.length) { const { data: p } = await supabase.from('perks').select('*').in('id', perk_ids); for (const x of p) bp += x.cost; }
  if (bp < 0) return res.status(400).json({ error: `Не хватает очков: ${bp}` });
  const { data: ch, error } = await supabase.from('characters').insert({ user_id: req.user.id, campaign_id, name, profession_id, balance_points: bp, food: 100, water: 100, stress: 0 }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  for (const ss of (prof.starter_skills || [])) {
    const { data: sk } = await supabase.from('skills').select('id').eq('name', ss.skill).single();
    if (sk) await supabase.from('character_skills').insert({ character_id: ch.id, skill_id: sk.id, modifier: ss.modifier });
  }
  if (perk_ids?.length) for (const pid of perk_ids) await supabase.from('character_perks').insert({ character_id: ch.id, perk_id: pid });
  await supabase.from('campaign_members').update({ character_id: ch.id }).eq('campaign_id', campaign_id).eq('user_id', req.user.id);
  res.json(ch);
});
app.get('/api/characters/:id', authMiddleware, async (req, res) => {
  const { data: ch } = await supabase.from('characters').select('*').eq('id', req.params.id).single();
  if (!ch) return res.status(404).json({ error: 'Не найден' });
  const { data: prof } = await supabase.from('professions').select('*').eq('id', ch.profession_id).single();
  const { data: cp } = await supabase.from('character_perks').select('perk_id').eq('character_id', ch.id);
  const pIds = cp.map(x => x.perk_id);
  let perks = [];
  if (pIds.length) { const { data } = await supabase.from('perks').select('*').in('id', pIds); perks = data; }
  const { data: cs } = await supabase.from('character_skills').select('skill_id, modifier').eq('character_id', ch.id);
  const sIds = cs.map(x => x.skill_id);
  let skills = [];
  if (sIds.length) {
    const { data: sd } = await supabase.from('skills').select('*').in('id', sIds);
    skills = sd.map(s => ({ ...s, modifier: cs.find(e => e.skill_id === s.id)?.modifier || 0 }));
  }
  const sm = {};
  for (const p of perks) for (const m of (p.effect_modifiers || [])) sm[m.skill] = (sm[m.skill] || 0) + (m.modifier || 0);
  skills = skills.map(s => ({ ...s, totalModifier: (s.modifier||0)+(sm[s.name]||0), perkBonus: sm[s.name]||0 }));
  const { data: inv } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('character_id', ch.id);
  res.json({ ...ch, profession: prof, perks, skills, inventory: inv || [] });
});
app.put('/api/characters/:id/params', authMiddleware, async (req, res) => {
  const allowed = ['food','water','stress','game_time_date','game_time_hours','game_time_minutes','carry_weight_max'];
  const updates = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  const { data, error } = await supabase.from('characters').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ===== INVENTORY =====
app.post('/api/inventory/add', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity, slot_type } = req.body;
  const st = slot_type || 'рюкзак';
  const { data: existing } = await supabase.from('inventory_slots').select('*').eq('character_id', character_id).eq('item_id', item_id).eq('slot_type', st).single();
  if (existing && !['правая_рука','левая_рука','тело','экзоскелет'].includes(st)) {
    const { data, error } = await supabase.from('inventory_slots').update({ quantity: existing.quantity + (quantity || 1) }).eq('id', existing.id).select('*, item:items(*)').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const { data, error } = await supabase.from('inventory_slots').insert({ character_id, item_id, quantity: quantity || 1, slot_type: st, equipped: false, position: 0 }).select('*, item:items(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/inventory/remove', authMiddleware, async (req, res) => {
  const { slot_id, quantity } = req.body;
  const { data: slot } = await supabase.from('inventory_slots').select('*').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });
  const nq = slot.quantity - (quantity || 1);
  if (nq <= 0) { await supabase.from('inventory_slots').delete().eq('id', slot_id); return res.json({ deleted: true }); }
  const { data, error } = await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', slot_id).select('*, item:items(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/inventory/equip', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });
  const item = slot.item;
  const cid = slot.character_id;

  if (item.is_weapon) {
    const { data: hands } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('character_id', cid).eq('equipped', true).in('slot_type', ['правая_рука', 'левая_рука']);
    let usedSlots = 0;
    for (const h of hands) usedSlots += (h.item?.is_heavy ? 2 : 1);
    const needed = item.is_heavy ? 2 : 1;
    if (usedSlots + needed > 2) return res.status(400).json({ error: 'Не хватает слотов рук. Снимите оружие.' });

    if (item.is_heavy) {
      for (const h of hands) await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('id', h.id);
      const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: 'правая_рука' }).eq('id', slot_id).select('*, item:items(*)').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    } else {
      const occupiedSlots = hands.map(h => h.slot_type);
      let target = 'правая_рука';
      if (occupiedSlots.includes('правая_рука') && !occupiedSlots.includes('левая_рука')) target = 'левая_рука';
      else if (occupiedSlots.includes('правая_рука') && occupiedSlots.includes('левая_рука')) {
        const left = hands.find(h => h.slot_type === 'левая_рука');
        if (left) await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('id', left.id);
        target = 'левая_рука';
      } else if (occupiedSlots.includes('левая_рука') && !occupiedSlots.includes('правая_рука')) target = 'правая_рука';
      const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: target }).eq('id', slot_id).select('*, item:items(*)').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }
  }
  if (item.is_armor || item.type === 'броня') {
    await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('character_id', cid).eq('slot_type', 'тело').neq('id', slot_id);
    const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: 'тело' }).eq('id', slot_id).select('*, item:items(*)').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  if (item.type === 'экзоскелет') {
    await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('character_id', cid).eq('slot_type', 'экзоскелет').neq('id', slot_id);
    const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: 'экзоскелет' }).eq('id', slot_id).select('*, item:items(*)').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  res.status(400).json({ error: 'Нельзя экипировать' });
});
app.post('/api/inventory/unequip', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data, error } = await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('id', slot_id).select('*, item:items(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/inventory/use', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });
  const item = slot.item;
  if (item.weapon_type === 'ranged' && slot.equipped) {
    if ((item.current_ammo || 0) <= 0) return res.status(400).json({ error: 'Нет патронов' });
    await supabase.from('items').update({ current_ammo: (item.current_ammo || 1) - 1 }).eq('id', item.id);
    return res.json({ used: 'ammo', remaining: (item.current_ammo || 1) - 1 });
  }
  if (item.weapon_type === 'thrown' && slot.equipped) {
    await supabase.from('inventory_slots').delete().eq('id', slot_id);
    return res.json({ used: 'thrown', deleted: true });
  }
  if (item.type === 'расходник') {
    const nq = slot.quantity - 1;
    if (nq <= 0) { await supabase.from('inventory_slots').delete().eq('id', slot_id); return res.json({ used: 'consumable', deleted: true }); }
    await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', slot_id);
    return res.json({ used: 'consumable', remaining: nq });
  }
  res.status(400).json({ error: 'Нельзя использовать' });
});
app.post('/api/inventory/reload', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', slot_id).single();
  if (!slot || !slot.item?.is_weapon || slot.item?.weapon_type !== 'ranged') {
    return res.status(400).json({ error: 'Не дальнобойное оружие' });
  }
  const neededAmmoType = slot.item.ammo_type;
  if (!neededAmmoType) return res.status(400).json({ error: 'Для этого оружия не указан тип патронов' });
  const maxAmmo = slot.item.max_ammo || 0;
  const currentAmmo = slot.item.current_ammo || 0;
  const needed = maxAmmo - currentAmmo;
  if (needed <= 0) return res.status(400).json({ error: 'Магазин уже полон' });

  const { data: allSlots } = await supabase.from('inventory_slots')
    .select('*, item:items(*)')
    .eq('character_id', slot.character_id)
    .eq('equipped', false)
    .eq('item.trade_category', 'патроны');
  const ammoSlot = allSlots?.find(s => s.item?.ammo_type === neededAmmoType);
  if (!ammoSlot) return res.status(400).json({ error: `Нет патронов типа "${neededAmmoType}" в инвентаре` });

  const ammoAvailable = ammoSlot.quantity;
  const toReload = Math.min(needed, ammoAvailable);
  await supabase.from('items').update({ current_ammo: currentAmmo + toReload }).eq('id', slot.item.id);
  const remaining = ammoAvailable - toReload;
  if (remaining <= 0) await supabase.from('inventory_slots').delete().eq('id', ammoSlot.id);
  else await supabase.from('inventory_slots').update({ quantity: remaining }).eq('id', ammoSlot.id);

  res.json({ success: true, current_ammo: currentAmmo + toReload, max_ammo: maxAmmo, used: toReload, remaining_ammo_in_inventory: Math.max(0, remaining), ammo_type: neededAmmoType });
});

// ===== NPC =====
app.get('/api/npcs', authMiddleware, async (req, res) => {
  const { campaign_id, is_template } = req.query;
  let q = supabase.from('npcs').select('*');
  if (campaign_id) q = q.eq('campaign_id', campaign_id);
  if (is_template) q = q.eq('is_template', true);
  const { data } = await q;
  res.json(data || []);
});
app.post('/api/npcs', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('npcs').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.put('/api/npcs/:id', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('npcs').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/npcs/:id', authMiddleware, async (req, res) => {
  await supabase.from('npcs').delete().eq('id', req.params.id);
  res.json({ success: true });
});
app.post('/api/npcs/:id/clone', authMiddleware, async (req, res) => {
  const { data: orig } = await supabase.from('npcs').select('*').eq('id', req.params.id).single();
  if (!orig) return res.status(404).json({ error: 'Не найден' });
  const { data: clone, error } = await supabase.from('npcs').insert({ 
    name: req.body.name || `${orig.name} (копия)`, type: orig.type, health_thresholds: orig.health_thresholds, 
    skills: orig.skills, special_properties: orig.special_properties, visibility: orig.visibility, 
    campaign_id: orig.campaign_id, is_template: false 
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(clone);
});
app.post('/api/npcs/:id/roll', authMiddleware, async (req, res) => {
  const { data: npc } = await supabase.from('npcs').select('*').eq('id', req.params.id).single();
  if (!npc) return res.status(404).json({ error: 'Не найден' });
  const skill = (npc.skills||[]).find(s => s.name === req.body.skill_name);
  if (!skill) return res.status(404).json({ error: 'Навык не найден' });
  const mod = skill.modifier || 0;
  const d20 = Math.floor(Math.random()*20)+1;
  res.json({ npc_name: npc.name, skill_name: req.body.skill_name, d20roll: d20, modifier: mod, sum: d20+mod, formula: `d20 (${d20}) + ${mod}` });
});

// ===== ITEMS =====
app.get('/api/items', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('items').select('*');
  res.json(data);
});
app.post('/api/items', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ===== DICE =====
app.post('/api/dice/auto', authMiddleware, async (req, res) => {
  const { character_id, skill_name } = req.body;
  const { data: ch } = await supabase.from('characters').select('*').eq('id', character_id).single();
  if (!ch) return res.status(404).json({ error: 'Не найден' });
  const { data: cs } = await supabase.from('character_skills').select('skill_id, modifier').eq('character_id', character_id);
  const sIds = cs.map(x => x.skill_id);
  const { data: sd } = await supabase.from('skills').select('*').in('id', sIds);
  const charSkills = sd.map(s => ({ ...s, baseModifier: cs.find(e => e.skill_id === s.id)?.modifier || 0 }));
  const skill = charSkills.find(s => s.name === skill_name);
  if (!skill) return res.status(404).json({ error: 'Навык не найден' });
  const { data: cp } = await supabase.from('character_perks').select('perk_id').eq('character_id', character_id);
  const pIds = cp.map(x => x.perk_id);
  let pb = 0;
  if (pIds.length) {
    const { data: perks } = await supabase.from('perks').select('*').in('id', pIds);
    for (const p of perks) for (const m of (p.effect_modifiers||[])) if (m.skill === skill_name) pb += m.modifier||0;
  }
  const total = (skill.baseModifier||0) + pb;
  const d20 = Math.floor(Math.random()*20)+1;
  res.json({ character_id, skill_name, d20roll: d20, baseModifier: skill.baseModifier||0, perkBonus: pb, totalModifier: total, sum: d20+total, formula: `d20 (${d20}) + ${total}` });
});

// ===== SCENES =====
app.get('/api/scenes/:campaign_id', authMiddleware, async (req, res) => {
  const { type } = req.query;
  const query = supabase.from('scenes').select('*').eq('campaign_id', req.params.campaign_id);
  if (type) query.eq('scene_type', type);
  const { data } = await query;
  res.json(data || []);
});
app.put('/api/scenes/:campaign_id', authMiddleware, async (req, res) => {
  const { scene_type, background_url, fog_of_war, tokens, drawings } = req.body;
  if (!scene_type) return res.status(400).json({ error: 'scene_type обязателен' });
  const { data: existing } = await supabase.from('scenes')
    .select('id').eq('campaign_id', req.params.campaign_id).eq('scene_type', scene_type).single();
  if (existing) {
    const updates = {};
    if (background_url !== undefined) updates.background_url = background_url;
    if (fog_of_war !== undefined) updates.fog_of_war = fog_of_war;
    if (tokens !== undefined) updates.tokens = tokens;
    if (drawings !== undefined) updates.drawings = drawings;
    const { data, error } = await supabase.from('scenes').update(updates).eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } else {
    const { data, error } = await supabase.from('scenes').insert({
      campaign_id: req.params.campaign_id, scene_type, background_url: background_url || null,
      fog_of_war: fog_of_war || [], tokens: tokens || [], drawings: drawings || []
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
});

// ===== BACKGROUNDS =====
app.post('/api/upload/background', authMiddleware, async (req, res) => {
  const { campaign_id, name, url } = req.body;
  if (!campaign_id || !url) return res.status(400).json({ error: 'campaign_id и url обязательны' });
  const { data, error } = await supabase.from('backgrounds').insert({ campaign_id, name, url }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get('/api/backgrounds/:campaign_id', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('backgrounds').select('*').eq('campaign_id', req.params.campaign_id);
  res.json(data || []);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`APOSTOL на ${PORT}`));
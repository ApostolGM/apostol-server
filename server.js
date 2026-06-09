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
  try { req.user = jwt.verify(header.split(' ')[1], JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Токен недействителен' }); }
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
        const sock = io.sockets.sockets.get(sid);
        if (sock?.data?.role && ['master','co-master'].includes(sock.data.role)) sock.emit('dice_result', payload);
      }
      socket.emit('dice_result', payload);
    } else io.to(`campaign:${data.campaignId}`).emit('dice_result', payload);
  });
  socket.on('set_role', (r) => { socket.data.role = r; });
  socket.on('disconnect', () => {
    for (const [uid, d] of activeUsers.entries()) { if (d.socketId === socket.id) { activeUsers.delete(uid); break; } }
  });
});

// Auth
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
  if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
  if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ user: { id: user.id, username: user.username, avatar_url: user.avatar_url }, token });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('users').select('id, username, avatar_url').eq('id', req.user.id).single();
  res.json(data);
});

// Campaigns
app.post('/api/campaigns', authMiddleware, async (req, res) => {
  const code = uuidv4().substring(0, 8);
  const { data: c, error } = await supabase.from('campaigns').insert({ title: req.body.title, master_id: req.user.id, invite_code: code }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('campaign_members').insert({ campaign_id: c.id, user_id: req.user.id, role: 'master' });
  await supabase.from('scenes').insert({ campaign_id: c.id });
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

// Professions, Perks, Skills
app.get('/api/professions', authMiddleware, async (req, res) => { const { data } = await supabase.from('professions').select('*').eq('is_global', true); res.json(data); });
app.get('/api/perks', authMiddleware, async (req, res) => { const { data } = await supabase.from('perks').select('*').eq('is_global', true); res.json(data); });
app.get('/api/skills', authMiddleware, async (req, res) => { const { data } = await supabase.from('skills').select('*').eq('is_global', true); res.json(data); });

// Characters
app.post('/api/characters', authMiddleware, async (req, res) => {
  const { campaign_id, name, profession_id, perk_ids } = req.body;
  const { data: prof } = await supabase.from('professions').select('*').eq('id', profession_id).single();
  if (!prof) return res.status(400).json({ error: 'Профессия не найдена' });
  let bp = 10;
  if (perk_ids?.length) { const { data: perks } = await supabase.from('perks').select('*').in('id', perk_ids); for (const p of perks) bp += p.cost; }
  if (bp < 0) return res.status(400).json({ error: `Не хватает очков: ${bp}` });
  const { data: ch, error } = await supabase.from('characters').insert({
    user_id: req.user.id, campaign_id, name, profession_id, balance_points: bp, food: 100, water: 100, stress: 0,
    inventory_config: { пояс: 3, рюкзак: 10, разгрузка: 4 }
  }).select().single();
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
  let perks = []; if (pIds.length) { const { data } = await supabase.from('perks').select('*').in('id', pIds); perks = data; }
  const { data: cs } = await supabase.from('character_skills').select('skill_id, modifier').eq('character_id', ch.id);
  const sIds = cs.map(x => x.skill_id);
  let skills = []; if (sIds.length) {
    const { data: sd } = await supabase.from('skills').select('*').in('id', sIds);
    skills = sd.map(s => ({ ...s, modifier: cs.find(e => e.skill_id === s.id)?.modifier || 0 }));
  }
  const sm = {}; for (const p of perks) for (const m of (p.effect_modifiers || [])) sm[m.skill] = (sm[m.skill] || 0) + (m.modifier || 0);
  skills = skills.map(s => ({ ...s, totalModifier: (s.modifier||0) + (sm[s.name]||0), perkBonus: sm[s.name]||0 }));
  const { data: inv } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('character_id', ch.id);
  res.json({ ...ch, profession: prof, perks, skills, inventory: inv || [] });
});

app.put('/api/characters/:id/params', authMiddleware, async (req, res) => {
  const allowed = ['food','water','stress','game_time_date','game_time_hours','game_time_minutes','carry_weight_max','inventory_config'];
  const up = {}; for (const k of allowed) if (req.body[k] !== undefined) up[k] = req.body[k];
  const { data, error } = await supabase.from('characters').update(up).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Inventory
app.post('/api/inventory/add', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity, slot_type } = req.body;
  const slot = slot_type || 'рюкзак';
  const { data: item } = await supabase.from('items').select('*').eq('id', item_id).single();
  if (!item) return res.status(404).json({ error: 'Предмет не найден' });

  // Для оружия создаём копию предмета чтобы у каждого был свой боезапас
  let finalItemId = item_id;
  if (item.is_weapon) {
    const { data: copy } = await supabase.from('items').insert({
      ...item, id: undefined, is_global: false, campaign_id: null,
      current_ammo: 0, max_ammo: item.max_ammo || 0
    }).select().single();
    if (copy) finalItemId = copy.id;
  }

  const { data: existing } = await supabase.from('inventory_slots').select('*').eq('character_id', character_id).eq('item_id', finalItemId).eq('slot_type', slot).single();
  if (existing && !item.is_weapon) {
    const { data, error } = await supabase.from('inventory_slots').update({ quantity: existing.quantity + (quantity||1) }).eq('id', existing.id).select('*, item:items(*)').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const { data, error } = await supabase.from('inventory_slots').insert({
    character_id, item_id: finalItemId, quantity: quantity||1, slot_type: slot, equipped: false, position: 0
  }).select('*, item:items(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/inventory/remove', authMiddleware, async (req, res) => {
  const { slot_id, quantity } = req.body;
  const { data: slot } = await supabase.from('inventory_slots').select('*').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });
  const nq = slot.quantity - (quantity||1);
  if (nq <= 0) {
    await supabase.from('inventory_slots').delete().eq('id', slot_id);
    return res.json({ deleted: true });
  }
  const { data, error } = await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', slot_id).select('*, item:items(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/inventory/equip', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Не найден' });
  const item = slot.item;
  const charId = slot.character_id;

  if (item.is_weapon) {
    await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('character_id', charId).in('slot_type', ['правая_рука','левая_рука']);
    const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: 'правая_рука' }).eq('id', slot_id).select('*, item:items(*)').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  if (item.is_armor || item.type === 'броня') {
    await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('character_id', charId).eq('slot_type', 'тело');
    const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: 'тело' }).eq('id', slot_id).select('*, item:items(*)').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  res.status(400).json({ error: 'Нельзя экипировать' });
});

app.post('/api/inventory/unequip', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('id', req.body.slot_id).select('*, item:items(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/inventory/reload', authMiddleware, async (req, res) => {
  const { weapon_slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', weapon_slot_id).single();
  if (!slot?.item?.is_weapon || slot.item.weapon_type !== 'ranged') return res.status(400).json({ error: 'Не дальнобойное оружие' });
  const needed = (slot.item.max_ammo || 0) - (slot.item.current_ammo || 0);
  if (needed <= 0) return res.status(400).json({ error: 'Уже заряжено' });

  const { data: ammo } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('character_id', slot.character_id).eq('item.type', 'патроны').limit(1).single();
  if (!ammo) return res.status(400).json({ error: 'Нет патронов' });

  await supabase.from('items').update({ current_ammo: slot.item.max_ammo }).eq('id', slot.item.id);
  if (ammo.quantity <= 1) await supabase.from('inventory_slots').delete().eq('id', ammo.id);
  else await supabase.from('inventory_slots').update({ quantity: ammo.quantity - 1 }).eq('id', ammo.id);

  res.json({ success: true, current_ammo: slot.item.max_ammo });
});

app.post('/api/inventory/shoot', authMiddleware, async (req, res) => {
  const { weapon_slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', weapon_slot_id).single();
  if (!slot?.item?.is_weapon) return res.status(400).json({ error: 'Не оружие' });
  if (slot.item.weapon_type === 'melee') return res.json({ message: 'Удар холодным оружием!', ammo: null });
  if (slot.item.weapon_type === 'thrown') {
    await supabase.from('inventory_slots').delete().eq('id', weapon_slot_id);
    return res.json({ message: 'Метательное оружие использовано и потеряно!', ammo: null, thrown: true });
  }
  if ((slot.item.current_ammo || 0) <= 0) return res.status(400).json({ error: 'Нет патронов! Нажмите Перезарядить' });
  const newAmmo = (slot.item.current_ammo || 0) - 1;
  await supabase.from('items').update({ current_ammo: newAmmo }).eq('id', slot.item.id);
  res.json({ message: 'Выстрел!', current_ammo: newAmmo, max_ammo: slot.item.max_ammo });
});

app.post('/api/inventory/consume', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', slot_id).single();
  if (!slot?.item?.is_consumable) return res.status(400).json({ error: 'Нельзя использовать' });

  const { data: ch } = await supabase.from('characters').select('*').eq('id', slot.character_id).single();
  const effect = slot.item.consume_effect;
  const updates = {};

  if (effect === 'food') updates.food = Math.min(100, (ch.food || 0) + 15);
  else if (effect === 'water') updates.water = Math.min(100, (ch.water || 0) + 20);
  else if (effect === 'heal') { /* нарративно, просто тратим предмет */ }

  await supabase.from('characters').update(updates).eq('id', ch.id);

  if (slot.quantity <= 1) await supabase.from('inventory_slots').delete().eq('id', slot_id);
  else await supabase.from('inventory_slots').update({ quantity: slot.quantity - 1 }).eq('id', slot_id);

  res.json({ success: true, effect, updates });
});

app.post('/api/inventory/move', authMiddleware, async (req, res) => {
  const { slot_id, new_slot_type } = req.body;
  const { data, error } = await supabase.from('inventory_slots').update({ slot_type: new_slot_type, equipped: false }).eq('id', slot_id).select('*, item:items(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// NPC
app.get('/api/npcs', authMiddleware, async (req, res) => {
  let q = supabase.from('npcs').select('*');
  if (req.query.campaign_id) q = q.eq('campaign_id', req.query.campaign_id);
  if (req.query.is_template) q = q.eq('is_template', true);
  const { data } = await q; res.json(data || []);
});
app.post('/api/npcs', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('npcs').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message }); res.json(data);
});
app.put('/api/npcs/:id', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('npcs').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message }); res.json(data);
});
app.delete('/api/npcs/:id', authMiddleware, async (req, res) => {
  await supabase.from('npcs').delete().eq('id', req.params.id); res.json({ success: true });
});
app.post('/api/npcs/:id/clone', authMiddleware, async (req, res) => {
  const { data: orig } = await supabase.from('npcs').select('*').eq('id', req.params.id).single();
  if (!orig) return res.status(404).json({ error: 'Не найден' });
  const { name, type, health_thresholds, skills, special_properties, visibility, campaign_id } = orig;
  const { data: clone } = await supabase.from('npcs').insert({
    name: req.body.name || `${name} (копия)`, type, health_thresholds, skills, special_properties, visibility, campaign_id, is_template: false
  }).select().single();
  res.json(clone);
});
app.post('/api/npcs/:id/roll', authMiddleware, async (req, res) => {
  const { data: npc } = await supabase.from('npcs').select('*').eq('id', req.params.id).single();
  if (!npc) return res.status(404);
  const skill = (npc.skills||[]).find(s => s.name === req.body.skill_name);
  if (!skill) return res.status(404);
  const mod = skill.modifier||0, d20 = Math.floor(Math.random()*20)+1;
  res.json({ npc_name: npc.name, skill_name: req.body.skill_name, d20roll: d20, modifier: mod, sum: d20+mod, formula: `d20 (${d20}) + ${mod}` });
});

// Items
app.get('/api/items', authMiddleware, async (req, res) => { const { data } = await supabase.from('items').select('*').eq('is_global', true); res.json(data); });
app.post('/api/items', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message }); res.json(data);
});

// Dice
app.post('/api/dice/auto', authMiddleware, async (req, res) => {
  const { character_id, skill_name } = req.body;
  const { data: ch } = await supabase.from('characters').select('*').eq('id', character_id).single();
  if (!ch) return res.status(404);
  const { data: cs } = await supabase.from('character_skills').select('skill_id, modifier').eq('character_id', character_id);
  const sIds = cs.map(x => x.skill_id);
  const { data: sd } = await supabase.from('skills').select('*').in('id', sIds);
  const csk = sd.map(s => ({ ...s, baseModifier: cs.find(e => e.skill_id === s.id)?.modifier||0 }));
  const skill = csk.find(s => s.name === skill_name);
  if (!skill) return res.status(404);
  const { data: cp } = await supabase.from('character_perks').select('perk_id').eq('character_id', character_id);
  let pb = 0;
  if (cp.length) { const { data: perks } = await supabase.from('perks').select('*').in('id', cp.map(x => x.perk_id));
    for (const p of perks) for (const m of (p.effect_modifiers||[])) if (m.skill === skill_name) pb += m.modifier||0; }
  const total = (skill.baseModifier||0) + pb;
  const d20 = Math.floor(Math.random()*20)+1;
  res.json({ character_id, skill_name, d20roll: d20, baseModifier: skill.baseModifier||0, perkBonus: pb, totalModifier: total, sum: d20+total, formula: `d20 (${d20}) + ${total}` });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
httpServer.listen(process.env.PORT || 3000, () => console.log('APOSTOL running'));

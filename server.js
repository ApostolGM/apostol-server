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
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET;

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Нет токена' });
  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Токен недействителен' });
  }
}

const activeUsers = new Map();

// ===== WEBSOCKET =====
io.on('connection', (socket) => {
  socket.on('join_campaign', ({ userId, campaignId }) => {
    socket.join(`campaign:${campaignId}`);
    activeUsers.set(userId, { socketId: socket.id, campaignId });
  });
  socket.on('leave_campaign', ({ userId }) => {
    const user = activeUsers.get(userId);
    if (user) {
      socket.leave(`campaign:${user.campaignId}`);
      activeUsers.delete(userId);
    }
  });
  socket.on('dice_roll', (data) => {
    const payload = { ...data, time: new Date().toISOString() };
    if (data.hidden) {
      const room = io.sockets.adapter.rooms.get(`campaign:${data.campaignId}`);
      if (room) {
        for (const sid of room) {
          const sock = io.sockets.sockets.get(sid);
          if (sock?.data?.role && ['master', 'co-master'].includes(sock.data.role)) {
            sock.emit('dice_result', payload);
          }
        }
      }
      socket.emit('dice_result', payload);
    } else {
      io.to(`campaign:${data.campaignId}`).emit('dice_result', payload);
    }
  });
  socket.on('set_role', (role) => { socket.data.role = role; });
  socket.on('disconnect', () => {
    for (const [uid, d] of activeUsers.entries()) {
      if (d.socketId === socket.id) { activeUsers.delete(uid); break; }
    }
  });
});

// ===== АВТОРИЗАЦИЯ =====
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
  const { data: existing } = await supabase.from('users').select('id').eq('username', username).single();
  if (existing) return res.status(409).json({ error: 'Пользователь уже существует' });
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
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ user: { id: user.id, username: user.username, avatar_url: user.avatar_url }, token });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const { data: user } = await supabase.from('users').select('id, username, avatar_url').eq('id', req.user.id).single();
  res.json(user);
});

// ===== КАМПАНИИ =====
app.post('/api/campaigns', authMiddleware, async (req, res) => {
  const { title } = req.body;
  const invite_code = uuidv4().substring(0, 8);
  const { data: campaign, error } = await supabase.from('campaigns').insert({ title, master_id: req.user.id, invite_code }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('campaign_members').insert({ campaign_id: campaign.id, user_id: req.user.id, role: 'master' });
  await supabase.from('scenes').insert({ campaign_id: campaign.id });
  res.json(campaign);
});

app.post('/api/campaigns/join/:code', authMiddleware, async (req, res) => {
  const { data: campaign } = await supabase.from('campaigns').select('*').eq('invite_code', req.params.code).single();
  if (!campaign) return res.status(404).json({ error: 'Кампания не найдена' });
  const { data: existing } = await supabase.from('campaign_members').select('id').eq('campaign_id', campaign.id).eq('user_id', req.user.id).single();
  if (existing) return res.status(409).json({ error: 'Вы уже в этой кампании' });
  await supabase.from('campaign_members').insert({ campaign_id: campaign.id, user_id: req.user.id, role: 'player' });
  res.json(campaign);
});

app.get('/api/campaigns', authMiddleware, async (req, res) => {
  const { data: members } = await supabase.from('campaign_members').select('campaign_id').eq('user_id', req.user.id);
  const ids = members.map(m => m.campaign_id);
  if (ids.length === 0) return res.json([]);
  const { data } = await supabase.from('campaigns').select('*').in('id', ids);
  res.json(data);
});

app.get('/api/campaigns/:id', authMiddleware, async (req, res) => {
  const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', req.params.id).single();
  if (!campaign) return res.status(404).json({ error: 'Не найдена' });
  const { data: members } = await supabase.from('campaign_members').select('user_id, role, character_id').eq('campaign_id', campaign.id);
  res.json({ ...campaign, members });
});

// ===== ПРОФЕССИИ =====
app.get('/api/professions', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('professions').select('*').eq('is_global', true);
  res.json(data);
});

// ===== ПЕРКИ =====
app.get('/api/perks', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('perks').select('*').eq('is_global', true);
  res.json(data);
});

// ===== НАВЫКИ =====
app.get('/api/skills', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('skills').select('*').eq('is_global', true);
  res.json(data);
});

// ===== ПЕРСОНАЖИ =====
app.post('/api/characters', authMiddleware, async (req, res) => {
  const { campaign_id, name, profession_id, perk_ids } = req.body;
  const { data: profession } = await supabase.from('professions').select('*').eq('id', profession_id).single();
  if (!profession) return res.status(400).json({ error: 'Профессия не найдена' });
  let balancePoints = 10;
  if (perk_ids?.length > 0) {
    const { data: perks } = await supabase.from('perks').select('*').in('id', perk_ids);
    for (const perk of perks) balancePoints += perk.cost;
  }
  if (balancePoints < 0) return res.status(400).json({ error: `Не хватает очков. Баланс: ${balancePoints}` });
  const { data: character, error } = await supabase.from('characters').insert({
    user_id: req.user.id, campaign_id, name, profession_id,
    balance_points: balancePoints, food: 100, water: 100, stress: 0
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  for (const ss of (profession.starter_skills || [])) {
    const { data: sk } = await supabase.from('skills').select('id').eq('name', ss.skill).single();
    if (sk) await supabase.from('character_skills').insert({ character_id: character.id, skill_id: sk.id, modifier: ss.modifier });
  }
  if (perk_ids?.length > 0) {
    for (const pid of perk_ids) await supabase.from('character_perks').insert({ character_id: character.id, perk_id: pid });
  }
  await supabase.from('campaign_members').update({ character_id: character.id }).eq('campaign_id', campaign_id).eq('user_id', req.user.id);
  res.json(character);
});

app.get('/api/characters/:id', authMiddleware, async (req, res) => {
  const { data: ch } = await supabase.from('characters').select('*').eq('id', req.params.id).single();
  if (!ch) return res.status(404).json({ error: 'Не найден' });
  const { data: prof } = await supabase.from('professions').select('*').eq('id', ch.profession_id).single();
  const { data: cp } = await supabase.from('character_perks').select('perk_id').eq('character_id', ch.id);
  const pIds = cp.map(p => p.perk_id);
  let perks = [];
  if (pIds.length > 0) { const { data } = await supabase.from('perks').select('*').in('id', pIds); perks = data; }
  const { data: cs } = await supabase.from('character_skills').select('skill_id, modifier').eq('character_id', ch.id);
  const sIds = cs.map(s => s.skill_id);
  let skills = [];
  if (sIds.length > 0) {
    const { data: sd } = await supabase.from('skills').select('*').in('id', sIds);
    skills = sd.map(s => {
      const cse = cs.find(e => e.skill_id === s.id);
      return { ...s, modifier: cse?.modifier || 0 };
    });
  }
  const sm = {};
  for (const p of perks) {
    for (const m of (p.effect_modifiers || [])) {
      sm[m.skill] = (sm[m.skill] || 0) + (m.modifier || 0);
    }
  }
  skills = skills.map(s => ({ ...s, totalModifier: (s.modifier || 0) + (sm[s.name] || 0), perkBonus: sm[s.name] || 0 }));

  // Инвентарь
  const { data: inv } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('character_id', ch.id);
  const inventory = inv || [];

  res.json({ ...ch, profession: prof, perks, skills, inventory });
});

app.put('/api/characters/:id/params', authMiddleware, async (req, res) => {
  const allowed = ['food', 'water', 'stress', 'game_time_date', 'game_time_hours', 'game_time_minutes', 'carry_weight_max'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  const { data, error } = await supabase.from('characters').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ===== ИНВЕНТАРЬ =====
app.post('/api/inventory/add', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity, slot_type } = req.body;
  const { data: existing } = await supabase.from('inventory_slots').select('*').eq('character_id', character_id).eq('item_id', item_id).eq('slot_type', slot_type).single();

  if (existing) {
    const { data, error } = await supabase.from('inventory_slots').update({ quantity: existing.quantity + (quantity || 1) }).eq('id', existing.id).select('*, item:items(*)').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const { data, error } = await supabase.from('inventory_slots').insert({
    character_id, item_id, quantity: quantity || 1, slot_type: slot_type || 'рюкзак', equipped: false, position: 0
  }).select('*, item:items(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/inventory/remove', authMiddleware, async (req, res) => {
  const { slot_id, quantity } = req.body;
  const { data: slot } = await supabase.from('inventory_slots').select('*').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });
  const newQty = slot.quantity - (quantity || 1);
  if (newQty <= 0) {
    await supabase.from('inventory_slots').delete().eq('id', slot_id);
    return res.json({ deleted: true });
  }
  const { data, error } = await supabase.from('inventory_slots').update({ quantity: newQty }).eq('id', slot_id).select('*, item:items(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/inventory/equip', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', slot_id).single();
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });

  const item = slot.item;
  const characterId = slot.character_id;

  if (item.is_weapon) {
    // Снять всё оружие с рук
    await supabase.from('inventory_slots').update({ equipped: false }).eq('character_id', characterId).eq('slot_type', 'правая_рука').neq('id', slot_id);
    await supabase.from('inventory_slots').update({ equipped: false }).eq('character_id', characterId).eq('slot_type', 'левая_рука').neq('id', slot_id);
    // Экипировать в правую руку
    const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: 'правая_рука' }).eq('id', slot_id).select('*, item:items(*)').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (item.is_armor || item.type === 'броня') {
    await supabase.from('inventory_slots').update({ equipped: false }).eq('character_id', characterId).eq('slot_type', 'тело').neq('id', slot_id);
    const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: 'тело' }).eq('id', slot_id).select('*, item:items(*)').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  res.status(400).json({ error: 'Этот предмет нельзя экипировать' });
});

app.post('/api/inventory/unequip', authMiddleware, async (req, res) => {
  const { slot_id } = req.body;
  const { data, error } = await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('id', slot_id).select('*, item:items(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Патроны
app.post('/api/inventory/reload', authMiddleware, async (req, res) => {
  const { weapon_slot_id } = req.body;
  const { data: weaponSlot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', weapon_slot_id).single();
  if (!weaponSlot || !weaponSlot.item?.is_weapon || weaponSlot.item?.weapon_type !== 'ranged') {
    return res.status(400).json({ error: 'Это не дальнобойное оружие' });
  }

  // Ищем патроны в инвентаре
  const { data: ammoSlots } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('character_id', weaponSlot.character_id).eq('item.type', 'патроны');
  if (!ammoSlots?.length) return res.status(400).json({ error: 'Нет патронов в инвентаре' });

  // Обновляем боезапас оружия
  const maxAmmo = weaponSlot.item.max_ammo || 0;
  await supabase.from('items').update({ current_ammo: maxAmmo }).eq('id', weaponSlot.item.id);

  // Убираем одну пачку патронов
  const ammo = ammoSlots[0];
  if (ammo.quantity <= 1) {
    await supabase.from('inventory_slots').delete().eq('id', ammo.id);
  } else {
    await supabase.from('inventory_slots').update({ quantity: ammo.quantity - 1 }).eq('id', ammo.id);
  }

  res.json({ success: true, current_ammo: maxAmmo, max_ammo: maxAmmo });
});

// ===== NPC =====
app.get('/api/npcs', authMiddleware, async (req, res) => {
  const { campaign_id, is_template } = req.query;
  let query = supabase.from('npcs').select('*');
  if (campaign_id) query = query.eq('campaign_id', campaign_id);
  if (is_template) query = query.eq('is_template', true);
  const { data } = await query;
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
  if (!orig) return res.status(404).json({ error: 'NPC не найден' });
  const { name, type, health_thresholds, skills, special_properties, visibility, campaign_id } = orig;
  const { data: clone, error } = await supabase.from('npcs').insert({
    name: req.body.name || `${name} (копия)`, type, health_thresholds, skills, special_properties, visibility, campaign_id, is_template: false
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(clone);
});

app.post('/api/npcs/:id/roll', authMiddleware, async (req, res) => {
  const { data: npc } = await supabase.from('npcs').select('*').eq('id', req.params.id).single();
  if (!npc) return res.status(404).json({ error: 'NPC не найден' });
  const skills = npc.skills || [];
  const skill = skills.find(s => s.name === req.body.skill_name);
  if (!skill) return res.status(404).json({ error: 'Навык не найден' });
  const mod = skill.modifier || 0;
  const d20 = Math.floor(Math.random() * 20) + 1;
  res.json({ npc_name: npc.name, skill_name: req.body.skill_name, d20roll: d20, modifier: mod, sum: d20 + mod, formula: `d20 (${d20}) + ${mod}` });
});

// ===== ПРЕДМЕТЫ =====
app.get('/api/items', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('items').select('*');
  res.json(data);
});

app.post('/api/items', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ===== БРОСОК =====
app.post('/api/dice/auto', authMiddleware, async (req, res) => {
  const { character_id, skill_name } = req.body;
  const { data: ch } = await supabase.from('characters').select('*').eq('id', character_id).single();
  if (!ch) return res.status(404).json({ error: 'Персонаж не найден' });
  const { data: cs } = await supabase.from('character_skills').select('skill_id, modifier').eq('character_id', character_id);
  const sIds = cs.map(s => s.skill_id);
  const { data: sd } = await supabase.from('skills').select('*').in('id', sIds);
  const charSkills = sd.map(s => ({ ...s, baseModifier: cs.find(e => e.skill_id === s.id)?.modifier || 0 }));
  const skill = charSkills.find(s => s.name === skill_name);
  if (!skill) return res.status(404).json({ error: 'Навык не найден' });
  const { data: cp } = await supabase.from('character_perks').select('perk_id').eq('character_id', character_id);
  const pIds = cp.map(p => p.perk_id);
  let pb = 0;
  if (pIds.length > 0) {
    const { data: perks } = await supabase.from('perks').select('*').in('id', pIds);
    for (const p of perks) {
      for (const m of (p.effect_modifiers || [])) {
        if (m.skill === skill_name) pb += m.modifier || 0;
      }
    }
  }
  const total = (skill.baseModifier || 0) + pb;
  const d20 = Math.floor(Math.random() * 20) + 1;
  res.json({ character_id, skill_name, d20roll: d20, baseModifier: skill.baseModifier || 0, perkBonus: pb, totalModifier: total, sum: d20 + total, formula: `d20 (${d20}) + ${total}` });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`APOSTOL на ${PORT}`));

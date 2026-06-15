// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { v2 as cloudinary } from 'cloudinary';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }
});

const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, message: { error: 'Слишком много запросов' }, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Слишком много попыток' } });
const chatLimiter = rateLimit({ windowMs: 1000, max: 5, message: { error: 'Слишком много сообщений' } });
const diceLimiter = rateLimit({ windowMs: 1000, max: 10, message: { error: 'Слишком много бросков' } });

app.use(cors({ origin: '*', allowedHeaders: ['Content-Type', 'Authorization'], methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.options('*', (req, res) => {   res.header('Access-Control-Allow-Origin', '*');   res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');   res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');   res.sendStatus(200); });
app.use(express.json({ limit: '50mb' }));
app.use(globalLimiter);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('Supabase URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
console.log('Service Role Key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET (length ' + process.env.SUPABASE_SERVICE_ROLE_KEY.length + ')' : 'MISSING');
const JWT_SECRET = process.env.JWT_SECRET;

cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });

// ===== MIDDLEWARE =====
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Нет токена' });
  try { req.user = jwt.verify(header.split(' ')[1], JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Токен недействителен' }); }
}

async function adminMiddleware(req, res, next) {
  const { data: userData } = await supabase.from('users').select('role').eq('id', req.user.id).single();
  if (!userData || userData.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  next();
}

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], { abortEarly: false });
    if (error) { const messages = error.details.map(d => d.message).join(', '); return res.status(400).json({ error: messages }); }
    req[source] = value; next();
  };
}

const schemas = {
  register: Joi.object({ username: Joi.string().min(3).max(50).required(), password: Joi.string().min(4).max(100).required() }),
  login: Joi.object({ username: Joi.string().required(), password: Joi.string().required() }),
  createCampaign: Joi.object({ title: Joi.string().min(1).max(255).required() }),
  createCharacter: Joi.object({ 
    campaign_id: Joi.string().uuid().required(), 
    name: Joi.string().min(1).max(100).required(), 
    profession_id: Joi.string().uuid().required(), 
    perk_ids: Joi.array().items(Joi.string().uuid()),
    perk_data: Joi.array().items(Joi.object({
      perk_id: Joi.string().uuid(),
      linked_perk_id: Joi.string().uuid().allow(null)
    })).optional()
  }),
  sendMessage: Joi.object({ text: Joi.string().min(1).max(2000).required(), is_roll: Joi.boolean().default(false) }),
  diceAuto: Joi.object({ character_id: Joi.string().uuid().required(), skill_name: Joi.string().required() }),
  npcRoll: Joi.object({ skill_name: Joi.string().required() }),
  updateScene: Joi.object({ scene_type: Joi.string().valid('local','global').required(), background_url: Joi.string().uri().allow(null), tokens: Joi.array(), drawings: Joi.array(), portals: Joi.array() }),
  uploadFile: Joi.object({ image: Joi.string().max(50*1024*1024).required(), name: Joi.string().required(), campaign_id: Joi.string().uuid() }),
  uploadSound: Joi.object({ sound_data: Joi.string().required(), name: Joi.string().required(), campaign_id: Joi.string().uuid().allow(null), is_global: Joi.boolean().default(false) }),
  createItem: Joi.object({
    name: Joi.string().required(),
    slot: Joi.string().required(),
    subcategory: Joi.string().allow('', null),
    icon: Joi.string().allow('', null),
    weight: Joi.number().min(0),
    condition_percent: Joi.number().min(0).max(100),
    description: Joi.string().allow(''),
    trade_price: Joi.number().min(0),
    weapon_type: Joi.string().valid('melee','ranged','thrown').allow(null),
    max_ammo: Joi.number().min(0),
    is_heavy: Joi.boolean(),
    ammo_type_id: Joi.string().uuid().allow(null),
    accepted_ammo_types: Joi.array().items(Joi.string().uuid()),
    mod_target: Joi.string().valid('weapon','armor','exo','any').allow(null),
    weapon_mod_subtype: Joi.string().valid('melee','ranged','thrown','any').allow(null),
    is_global: Joi.boolean().default(true),
    is_container: Joi.boolean().default(false),
    container_slots: Joi.number().integer().min(0).default(0),
    container_items: Joi.array().items(Joi.object({
      item_id: Joi.string().uuid().required(),
      quantity: Joi.number().integer().min(1).default(1)
    })).default([]),
  }),
};

async function enrichCharacter(ch) {
  if (!ch) return null;
  const enrichSingle = async (char) => {
    const [{ data: prof }, { data: cp }, { data: cs }, { data: inv }] = await Promise.all([
      supabase.from('professions').select('*').eq('id', char.profession_id).single(),
      supabase.from('character_perks').select('perk_id, linked_perk_id').eq('character_id', char.id),
      supabase.from('character_skills').select('skill_id, modifier').eq('character_id', char.id),
      supabase.from('inventory_slots')
        .select('*, item:items(*, ammo_type:ammo_types(*)), children:inventory_slots(*, item:items(*, ammo_type:ammo_types(*)))')
        .eq('character_id', char.id)
        .is('parent_slot_id', null)
    ]);
    const pIds = (cp||[]).map(x=>x.perk_id); const sIds = (cs||[]).map(x=>x.skill_id);
    const [{ data: perks }, { data: skills }] = await Promise.all([
      pIds.length ? supabase.from('perks').select('*').in('id',pIds) : Promise.resolve({ data: [] }),
      sIds.length ? supabase.from('skills').select('*').in('id',sIds) : Promise.resolve({ data: [] }),
    ]);
    const sm = {}; for (const p of (perks||[])) for (const m of (p.effect_modifiers||[])) if (m.skill) sm[m.skill] = (sm[m.skill]||0)+(m.modifier||0);
    
    // Адаптация: +5% к штрафу выбранного негативного перка
    for (const cpItem of (cp||[])) {
      if (cpItem.linked_perk_id) {
        const linkedPerk = (perks||[]).find(p => p.id === cpItem.linked_perk_id);
        if (linkedPerk) {
          for (const m of (linkedPerk.effect_modifiers||[])) {
            if (m.skill && m.modifier < 0) {
              sm[m.skill] = (sm[m.skill]||0) + 5;
            }
          }
        }
      }
    }
    
    // Бонусы к параметрам
    let carryBonus = 0;
    for (const p of (perks||[])) {
      for (const m of (p.effect_modifiers||[])) {
        if (m.param === 'carry_weight_max') carryBonus += (m.modifier || 0);
      }
    }
    
    const enrichedSkills = (skills||[]).map(s=>{ const bm = (cs||[]).find(e=>e.skill_id===s.id)?.modifier||0; const pb = sm[s.name]||0; return {...s, modifier:bm, baseModifier:bm, perkBonus:pb, totalModifier:bm+pb, totalPercent:bm+pb}; });
    const enrichedInventory = (inv||[]).map(slot => {
      const children = slot.children || [];
      let totalWeight = slot.item?.weight || 0;
      if (slot.item?.is_container && children.length > 0) {
        for (const child of children) totalWeight += (child.item?.weight || 0) * (child.quantity || 1);
      }
      return { ...slot, containerWeight: slot.item?.is_container ? totalWeight : null, children: children };
    });
    return {...char, profession: prof||null, perks: perks||[], skills: enrichedSkills, inventory: enrichedInventory, carry_weight_max: (char.carry_weight_max || 50) + carryBonus};
  };
  if (Array.isArray(ch)) return Promise.all(ch.map(enrichSingle));
  return enrichSingle(ch);
}

function getWeightPenalty(percent) {
  if (percent <= 70) return { penalty: 0, label: 'Норма' };
  if (percent <= 85) return { penalty: -5, label: 'Перегруз 85%' };
  if (percent <= 95) return { penalty: -15, label: 'Перегруз 95%' };
  if (percent <= 110) return { penalty: 'disadvantage', label: 'Помеха' };
  if (percent <= 125) return { penalty: 'double_disadvantage', label: 'Двойная помеха' };
  return { penalty: 'immobile', label: 'Невозможно двигаться' };
}

function notifyCampaign(campaignId, event, data) { io.to(`campaign:${campaignId}`).emit(event, data); }

// ===== SOCKET.IO =====
const activeUsers = new Map();
io.on('connection', (socket) => {
  socket.on('join_campaign', ({ userId, campaignId }) => { socket.join(`campaign:${campaignId}`); activeUsers.set(userId, { socketId: socket.id, campaignId }); });
  socket.on('leave_campaign', ({ userId }) => { const u = activeUsers.get(userId); if (u) { socket.leave(`campaign:${u.campaignId}`); activeUsers.delete(userId); } });
  socket.on('dice_roll', (data) => { const payload = {...data, time: new Date().toISOString()}; if (data.hidden) { const room = io.sockets.adapter.rooms.get(`campaign:${data.campaignId}`); if (room) for (const sid of room) { const s = io.sockets.sockets.get(sid); if (s?.data?.role && ['master','co-master'].includes(s.data.role)) s.emit('dice_result', payload); } socket.emit('dice_result', payload); } else io.to(`campaign:${data.campaignId}`).emit('dice_result', payload); });
  socket.on('scene_token_move', (data) => socket.to(`campaign:${data.campaignId}`).emit('scene_token_moved', data));
  socket.on('scene_update', (data) => socket.to(`campaign:${data.campaignId}`).emit('scene_updated', data));
  socket.on('scene_drawings', (data) => socket.to(`campaign:${data.campaignId}`).emit('scene_drawings', data));
  socket.on('scene_portals', (data) => socket.to(`campaign:${data.campaignId}`).emit('scene_portals', data));
  socket.on('sound_play', (data) => socket.to(`campaign:${data.campaignId}`).emit('sound_play', data));
  socket.on('sound_stop', (data) => socket.to(`campaign:${data.campaignId}`).emit('sound_stop', data));
  socket.on('set_role', (role) => { socket.data.role = role; });
  
  // Рассрочка гибели
  socket.on('death_loan_request', (data) => {
    const room = io.sockets.adapter.rooms.get(`campaign:${data.campaignId}`);
    if (room) {
      for (const sid of room) {
        const s = io.sockets.sockets.get(sid);
        if (s?.data?.role && ['master', 'co-master'].includes(s.data.role)) {
          s.emit('death_loan_requested', data);
        }
      }
    }
  });
  socket.on('death_loan_approve', async (data) => {
    await supabase.from('characters').update({ death_loan_count: (data.count || 0) + 1 }).eq('id', data.characterId);
    io.to(`campaign:${data.campaignId}`).emit('death_loan_approved', data);
  });
  socket.on('death_loan_force_fail', async (data) => {
    await supabase.from('characters').update({ death_loan_count: Math.max(0, (data.count || 1) - 1) }).eq('id', data.characterId);
    io.to(`campaign:${data.campaignId}`).emit('death_loan_forced', data);
  });

  socket.on('disconnect', () => { for (const [uid, d] of activeUsers.entries()) if (d.socketId === socket.id) { activeUsers.delete(uid); break; } });
});

// ===== AUTH =====
app.post('/api/auth/register', authLimiter, validate(schemas.register), async (req, res) => {
  const { username, password } = req.body;
  const { data: ex } = await supabase.from('users').select('id').eq('username', username).single();
  if (ex) return res.status(409).json({ error: 'Пользователь уже существует' });
  const hash = await bcrypt.hash(password, 10);
  const { data: user, error } = await supabase.from('users').insert({ username, password_hash: hash, role: 'player' }).select('id, username, avatar_url, role').single();
  if (error) return res.status(500).json({ error: error.message });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ user, token });
});

app.post('/api/auth/login', authLimiter, validate(schemas.login), async (req, res) => {
  const { username, password } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if (!user || !await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ user: { id: user.id, username: user.username, avatar_url: user.avatar_url, role: user.role }, token });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const { data: user } = await supabase.from('users').select('id, username, avatar_url, role').eq('id', req.user.id).single();
  res.json(user);
});

// ===== CAMPAIGNS =====
app.post('/api/campaigns', authMiddleware, adminMiddleware, validate(schemas.createCampaign), async (req, res) => {
  const { title } = req.body;
  const invite_code = uuidv4().substring(0, 8);
  const { data: c, error } = await supabase.from('campaigns').insert({ title, master_id: req.user.id, invite_code }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await Promise.all([ supabase.from('campaign_members').insert({ campaign_id: c.id, user_id: req.user.id, role: 'master' }), supabase.from('scenes').insert({ campaign_id: c.id, scene_type: 'local' }), supabase.from('scenes').insert({ campaign_id: c.id, scene_type: 'global' }) ]);
  res.json(c);
});

app.post('/api/campaigns/join/:code', authMiddleware, async (req, res) => {
  const { data: c } = await supabase.from('campaigns').select('*').eq('invite_code', req.params.code).single();
  if (!c) return res.status(404).json({ error: 'Кампания не найдена' });
  const { data: ex } = await supabase.from('campaign_members').select('id').eq('campaign_id', c.id).eq('user_id', req.user.id).single();
  if (ex) return res.status(409).json({ error: 'Вы уже в кампании' });
  await supabase.from('campaign_members').insert({ campaign_id: c.id, user_id: req.user.id, role: 'player' });
  notifyCampaign(c.id, 'campaign_members_updated', { campaignId: c.id });
  res.json(c);
});

app.get('/api/campaigns', authMiddleware, async (req, res) => {
  const { data: m } = await supabase.from('campaign_members').select('campaign_id').eq('user_id', req.user.id);
  if (!m?.length) return res.json([]);
  const { data } = await supabase.from('campaigns').select('*').in('id', m.map(x=>x.campaign_id));
  res.json(data);
});

app.get('/api/campaigns/:id', authMiddleware, async (req, res) => {
  const { data: c } = await supabase.from('campaigns').select('*').eq('id', req.params.id).single();
  if (!c) return res.status(404).json({ error: 'Не найдена' });
  const { data: members } = await supabase.from('campaign_members').select('user_id, role, character_id, user:users(username)').eq('campaign_id', c.id);
  res.json({...c, members});
});

app.put('/api/campaigns/:id/time', authMiddleware, async (req, res) => {
  const { game_time_date, game_time_hours, game_time_minutes } = req.body;
  const updates = {}; if (game_time_date !== undefined) updates.game_time_date = game_time_date; if (game_time_hours !== undefined) updates.game_time_hours = game_time_hours; if (game_time_minutes !== undefined) updates.game_time_minutes = game_time_minutes;
  const { data, error } = await supabase.from('campaigns').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  notifyCampaign(req.params.id, 'campaign_updated', data);
  res.json(data);
});

app.delete('/api/campaigns/:id/members/:userId', authMiddleware, async (req, res) => {
  const { data: member } = await supabase.from('campaign_members').select('role').eq('campaign_id', req.params.id).eq('user_id', req.user.id).single();
  if (!member || !['master', 'co-master'].includes(member.role)) return res.status(403).json({ error: 'Только для Мастера' });
  if (req.user.id === req.params.userId) return res.status(400).json({ error: 'Нельзя выгнать самого себя' });
  await supabase.from('campaign_members').delete().eq('campaign_id', req.params.id).eq('user_id', req.params.userId);
  notifyCampaign(req.params.id, 'campaign_members_updated', { campaignId: req.params.id });
  res.json({ success: true });
});

// ===== CHARACTERS =====
app.get('/api/campaigns/:id/characters', authMiddleware, async (req, res) => {
  const { data: member } = await supabase.from('campaign_members').select('role').eq('campaign_id', req.params.id).eq('user_id', req.user.id).single();
  if (!member || !['master','co-master'].includes(member.role)) return res.status(403).json({ error: 'Только для Мастера' });
  const { data: members } = await supabase.from('campaign_members').select('user_id, role, character_id').eq('campaign_id', req.params.id).eq('role','player').not('character_id','is',null);
  if (!members?.length) return res.json([]);
  const charIds = members.map(m=>m.character_id);
  const { data: chars } = await supabase.from('characters').select('*').in('id', charIds);
  if (!chars?.length) return res.json([]);
  const enriched = await enrichCharacter(chars);
  const enrichedWithOwner = enriched.map(ch=>{ const owner = members.find(m=>m.character_id===ch.id); return {...ch, owner_role: owner?.role, owner_id: owner?.user_id}; });
  res.json(enrichedWithOwner);
});

// Профессии
app.get('/api/professions', authMiddleware, async (req, res) => { const { data } = await supabase.from('professions').select('*').order('name'); res.json(data); });

// Перки
app.get('/api/perks', authMiddleware, async (req, res) => { const { data } = await supabase.from('perks').select('*').order('name'); res.json(data); });
const { data: testInsert, error: testError } = await supabase.from('character_perks').insert({
  character_id: ch.id,
  perk_id: perk_ids[0]
}).select();

console.log('TEST INSERT:', testInsert, testError?.message);
// Навыки
app.get('/api/skills', authMiddleware, async (req, res) => { const { data } = await supabase.from('skills').select('*, characteristic:characteristics(*)').order('name'); res.json(data); });
app.post('/api/characters', authMiddleware, validate(schemas.createCharacter), async (req, res) => {
  const { campaign_id, name, profession_id, perk_ids, perk_data } = req.body;
  console.log('perk_ids:', perk_ids);
  console.log('perk_data:', perk_data);
  const { data: member } = await supabase.from('campaign_members').select('role').eq('campaign_id', campaign_id).eq('user_id', req.user.id).single();
  if (!member || ['master','co-master'].includes(member.role)) return res.status(403).json({ error: 'Мастер не может создавать персонажа' });
  const { data: prof } = await supabase.from('professions').select('*').eq('id', profession_id).single();
  if (!prof) return res.status(400).json({ error: 'Профессия не найдена' });
  let bp = 10; if (perk_ids?.length) { const { data: perks } = await supabase.from('perks').select('*').in('id', perk_ids); for (const p of perks) bp += p.cost; }
  if (bp < 0) return res.status(400).json({ error: `Не хватает очков: ${bp}` });
  const { data: ch, error } = await supabase.from('characters').insert({ user_id: req.user.id, campaign_id, name, profession_id, balance_points: bp, food: 100, water: 100, stress: 0 }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const insertPromises = [];
  for (const ss of (prof.starter_skills||[])) { const { data: sk } = await supabase.from('skills').select('id').eq('name', ss.skill).single(); if (sk) insertPromises.push(supabase.from('character_skills').insert({ character_id: ch.id, skill_id: sk.id, modifier: ss.modifier })); }
  if (perk_ids?.length) {
    const pd = perk_data || [];
    for (const pid of perk_ids) {
      console.log('insertPromises count:', insertPromises.length);
      const pdd = pd.find(p => String(p.perk_id) === String(pid));
      insertPromises.push(
        supabase.from('character_perks').insert({
          character_id: ch.id,
          perk_id: pid,
          linked_perk_id: pdd?.linked_perk_id || null
        })
      );
    }
  }
  insertPromises.push(supabase.from('campaign_members').update({ character_id: ch.id }).eq('campaign_id', campaign_id).eq('user_id', req.user.id));
  await Promise.all(insertPromises);
  const enriched = await enrichCharacter(ch);
  notifyCampaign(campaign_id, 'character_updated', { character_id: ch.id, updates: enriched });
  res.json(enriched);
});

app.get('/api/characters/:id', authMiddleware, async (req, res) => { const { data: ch } = await supabase.from('characters').select('*').eq('id', req.params.id).single(); if (!ch) return res.status(404).json({ error: 'Не найден' }); const enriched = await enrichCharacter(ch); res.json(enriched); });

app.put('/api/characters/:id/params', authMiddleware, async (req, res) => {
  const allowed = ['food','water','stress','game_time_date','game_time_hours','game_time_minutes','carry_weight_max','currency'];
  const updates = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  const { data, error } = await supabase.from('characters').update(updates).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  if (data?.campaign_id) notifyCampaign(data.campaign_id, 'character_updated', { character_id: req.params.id, updates });
  res.json(data);
});

app.delete('/api/characters/:id', authMiddleware, async (req, res) => {
  const { data: ch } = await supabase.from('characters').select('campaign_id, user_id').eq('id', req.params.id).single();
  if (!ch) return res.status(404).json({ error: 'Персонаж не найден' });
  const { data: member } = await supabase.from('campaign_members').select('role').eq('campaign_id', ch.campaign_id).eq('user_id', req.user.id).single();
  if (!member || !['master','co-master'].includes(member.role)) return res.status(403).json({ error: 'Только для Мастера' });
  await Promise.all([ supabase.from('campaign_members').update({ character_id: null }).eq('character_id', req.params.id), supabase.from('inventory_slots').delete().eq('character_id', req.params.id), supabase.from('character_skills').delete().eq('character_id', req.params.id), supabase.from('character_perks').delete().eq('character_id', req.params.id), supabase.from('characters').delete().eq('id', req.params.id) ]);
  notifyCampaign(ch.campaign_id, 'character_deleted', { character_id: req.params.id });
  res.json({ success: true });
});

// ===== CHARACTER SKILLS =====
app.post('/api/characters/:id/skills', authMiddleware, async (req, res) => { const { skill_id, modifier } = req.body; const { data, error } = await supabase.from('character_skills').insert({ character_id: req.params.id, skill_id, modifier: modifier||0 }).select().single(); if (error) return res.status(500).json({ error: error.message }); const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', req.params.id).single(); if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'character_skills_updated', { character_id: req.params.id }); res.json(data); });
app.put('/api/characters/:id/skills/:skillId', authMiddleware, async (req, res) => { const { modifier } = req.body; const { data, error } = await supabase.from('character_skills').update({ modifier }).eq('character_id', req.params.id).eq('skill_id', req.params.skillId).select().single(); if (error) return res.status(500).json({ error: error.message }); const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', req.params.id).single(); if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'character_skills_updated', { character_id: req.params.id }); res.json(data); });
app.delete('/api/characters/:id/skills/:skillId', authMiddleware, async (req, res) => { await supabase.from('character_skills').delete().eq('character_id', req.params.id).eq('skill_id', req.params.skillId); const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', req.params.id).single(); if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'character_skills_updated', { character_id: req.params.id }); res.json({ success: true }); });

// ===== INVENTORY =====
app.get('/api/characters/:id/weight', authMiddleware, async (req, res) => {
  const { data: ch } = await supabase.from('characters').select('id, carry_weight_max').eq('id', req.params.id).single();
  if (!ch) return res.status(404).json({ error: 'Персонаж не найден' });
  const { data: slots } = await supabase.from('inventory_slots').select('quantity, item:items(weight, slot, is_container), children:inventory_slots(quantity, item:items(weight))').eq('character_id', ch.id).is('parent_slot_id', null);
  let totalWeight = 0;
  for (const s of (slots||[])) { if (s.item?.slot === 'currency') continue; totalWeight += (s.item?.weight || 0) * (s.quantity || 1); if (s.item?.is_container && s.children) for (const child of s.children) totalWeight += (child.item?.weight || 0) * (child.quantity || 1); }
  const maxWeight = ch.carry_weight_max || 50;
  const percent = Math.round((totalWeight / maxWeight) * 100);
  const penalty = getWeightPenalty(percent);
  res.json({ totalWeight, maxWeight, percent, penalty });
});

app.post('/api/inventory/add', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity, slot_type } = req.body;
  const { data: ch } = await supabase.from('characters').select('user_id, campaign_id').eq('id', character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });
  const { data: item } = await supabase.from('items').select('*').eq('id', item_id).single();
  const st = slot_type || (item?.slot === 'weapon' ? 'рюкзак' : item?.slot === 'armor' ? 'тело' : item?.slot === 'exo' ? 'экзоскелет' : 'рюкзак');
  const { data: existing } = await supabase.from('inventory_slots').select('*').eq('character_id', character_id).eq('item_id', item_id).eq('slot_type', st).single();
  if (existing && !['правая_рука','левая_рука','тело','экзоскелет'].includes(st)) {
    const { data, error } = await supabase.from('inventory_slots').update({ quantity: existing.quantity + (quantity||1) }).eq('id', existing.id).select('*, item:items(*, ammo_type:ammo_types(*))').single();
    if (error) return res.status(500).json({ error: error.message });
    if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id });
    return res.json(data);
  }
  const { data, error } = await supabase.from('inventory_slots').insert({ character_id, item_id, quantity: quantity||1, slot_type: st, equipped: false, position: 0 }).select('*, item:items(*, ammo_type:ammo_types(*))').single();
  if (error) return res.status(500).json({ error: error.message });
  if (item?.is_container && item.container_items?.length > 0) {
    const parentSlotId = data.id;
    for (const ci of item.container_items) { const { data: childItem } = await supabase.from('items').select('*').eq('id', ci.item_id).single(); if (childItem) await supabase.from('inventory_slots').insert({ character_id, item_id: ci.item_id, quantity: ci.quantity||1, slot_type: 'container', equipped: false, position: 0, parent_slot_id: parentSlotId }); }
  }
  if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id });
  res.json(data);
});

app.post('/api/inventory/remove', authMiddleware, async (req, res) => { const { slot_id, quantity } = req.body; const { data: slot } = await supabase.from('inventory_slots').select('*, character:characters(campaign_id, user_id)').eq('id', slot_id).single(); if (!slot) return res.status(404).json({ error: 'Не найден' }); if (slot.character?.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' }); const nq = slot.quantity - (quantity||1); if (nq <= 0) { await supabase.from('inventory_slots').delete().eq('id', slot_id); } else { await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', slot_id); } if (slot.character?.campaign_id) notifyCampaign(slot.character.campaign_id, 'inventory_updated', { character_id: slot.character_id }); res.json(nq <= 0 ? { deleted: true } : { success: true }); });
app.post('/api/inventory/equip', authMiddleware, async (req, res) => { const { slot_id } = req.body; const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', slot_id).single(); if (!slot) return res.status(404).json({ error: 'Не найден' }); const { data: ch } = await supabase.from('characters').select('user_id, campaign_id').eq('id', slot.character_id).single(); if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' }); const item = slot.item; const cid = slot.character_id; if (item.slot === 'weapon') { const { data: hands } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('character_id', cid).eq('equipped', true).in('slot_type', ['правая_рука','левая_рука']); let usedSlots = 0; for (const h of hands) usedSlots += (h.item?.is_heavy ? 2 : 1); const needed = item.is_heavy ? 2 : 1; if (usedSlots + needed > 2) return res.status(400).json({ error: 'Не хватает слотов рук' }); if (item.is_heavy) { for (const h of hands) await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('id', h.id); const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: 'правая_рука' }).eq('id', slot_id).select('*, item:items(*, ammo_type:ammo_types(*))').single(); if (error) return res.status(500).json({ error: error.message }); if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: cid }); return res.json(data); } else { const occupiedSlots = hands.map(h=>h.slot_type); let target = 'правая_рука'; if (occupiedSlots.includes('правая_рука') && !occupiedSlots.includes('левая_рука')) target = 'левая_рука'; else if (occupiedSlots.includes('правая_рука') && occupiedSlots.includes('левая_рука')) { const left = hands.find(h=>h.slot_type==='левая_рука'); if (left) await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('id', left.id); target = 'левая_рука'; } else if (occupiedSlots.includes('левая_рука') && !occupiedSlots.includes('правая_рука')) target = 'правая_рука'; const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: target }).eq('id', slot_id).select('*, item:items(*, ammo_type:ammo_types(*))').single(); if (error) return res.status(500).json({ error: error.message }); if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: cid }); return res.json(data); } } if (item.slot === 'armor') { await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('character_id', cid).eq('slot_type','тело').neq('id', slot_id); const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: 'тело' }).eq('id', slot_id).select('*, item:items(*, ammo_type:ammo_types(*))').single(); if (error) return res.status(500).json({ error: error.message }); if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: cid }); return res.json(data); } if (item.slot === 'exo') { await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('character_id', cid).eq('slot_type','экзоскелет').neq('id', slot_id); const { data, error } = await supabase.from('inventory_slots').update({ equipped: true, slot_type: 'экзоскелет' }).eq('id', slot_id).select('*, item:items(*, ammo_type:ammo_types(*))').single(); if (error) return res.status(500).json({ error: error.message }); if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: cid }); return res.json(data); } res.status(400).json({ error: 'Нельзя экипировать' }); });
app.post('/api/inventory/unequip', authMiddleware, async (req, res) => { const { slot_id } = req.body; const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', slot_id).single(); if (!slot) return res.status(404).json({ error: 'Не найден' }); const { data: ch } = await supabase.from('characters').select('user_id, campaign_id').eq('id', slot.character_id).single(); if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' }); const { data, error } = await supabase.from('inventory_slots').update({ equipped: false, slot_type: 'рюкзак' }).eq('id', slot_id).select('*, item:items(*, ammo_type:ammo_types(*))').single(); if (error) return res.status(500).json({ error: error.message }); if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: slot.character_id }); res.json(data); });
app.post('/api/inventory/use', authMiddleware, async (req, res) => { const { slot_id } = req.body; const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', slot_id).single(); if (!slot) return res.status(404).json({ error: 'Не найден' }); const { data: ch } = await supabase.from('characters').select('user_id, name, campaign_id').eq('id', slot.character_id).single(); if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' }); const item = slot.item; let result = null; if (item.weapon_type==='ranged' && slot.equipped) { if ((item.current_ammo||0)<=0) return res.status(400).json({ error: 'Нет патронов' }); await supabase.from('items').update({ current_ammo: (item.current_ammo||1)-1 }).eq('id', item.id); result = { used:'ammo', remaining:(item.current_ammo||1)-1, action:'выстрелил из' }; } else if (item.weapon_type==='thrown' && slot.equipped) { await supabase.from('inventory_slots').delete().eq('id', slot_id); result = { used:'thrown', deleted:true, action:'метнул' }; } else if (item.slot==='consumable') { const nq = slot.quantity-1; if (nq<=0) { await supabase.from('inventory_slots').delete().eq('id', slot_id); result = { used:'consumable', deleted:true, action:'использовал' }; } else { await supabase.from('inventory_slots').update({ quantity: nq }).eq('id', slot_id); result = { used:'consumable', remaining:nq, action:'использовал' }; } } else return res.status(400).json({ error: 'Нельзя использовать' }); if (ch.campaign_id) { const msgText = `${ch.name} ${result.action} ${item.name}`; const { data: msg } = await supabase.from('chat_messages').insert({ campaign_id: ch.campaign_id, user_id: req.user.id, username: ch.name, text: msgText, is_roll: false }).select().single(); if (msg) notifyCampaign(ch.campaign_id, 'chat_message', msg); notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: slot.character_id }); } res.json(result); });
app.post('/api/inventory/reload', authMiddleware, async (req, res) => { const { slot_id, ammo_type_id } = req.body; const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', slot_id).single(); if (!slot || slot.item?.slot !== 'weapon' || slot.item?.weapon_type !== 'ranged') return res.status(400).json({ error: 'Не дальнобойное оружие' }); const { data: ch } = await supabase.from('characters').select('user_id, campaign_id').eq('id', slot.character_id).single(); if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' }); const acceptedTypes = slot.item.accepted_ammo_types || []; if (acceptedTypes.length > 0 && ammo_type_id && !acceptedTypes.includes(ammo_type_id)) return res.status(400).json({ error: 'Этот тип патронов не подходит' }); const searchTypeId = ammo_type_id || slot.item.ammo_type_id; if (!searchTypeId) return res.status(400).json({ error: 'Не указан тип патронов' }); const maxAmmo = slot.item.max_ammo||0; const currentAmmo = slot.item.current_ammo||0; const needed = maxAmmo - currentAmmo; if (needed <= 0) return res.status(400).json({ error: 'Магазин уже полон' }); const { data: allSlots } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('character_id', slot.character_id).eq('equipped', false).eq('item.slot', 'ammo'); const ammoSlot = allSlots?.find(s => s.item?.ammo_type_id === searchTypeId); if (!ammoSlot) return res.status(400).json({ error: 'Нет подходящих патронов' }); const ammoAvailable = ammoSlot.quantity; const toReload = Math.min(needed, ammoAvailable); await supabase.from('items').update({ current_ammo: currentAmmo + toReload }).eq('id', slot.item.id); const remaining = ammoAvailable - toReload; if (remaining <= 0) await supabase.from('inventory_slots').delete().eq('id', ammoSlot.id); else await supabase.from('inventory_slots').update({ quantity: remaining }).eq('id', ammoSlot.id); if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: slot.character_id }); res.json({ success: true, current_ammo: currentAmmo + toReload, max_ammo, used: toReload, remaining_ammo_in_inventory: Math.max(0, remaining) }); });
app.put('/api/inventory/:slotId', authMiddleware, async (req, res) => { const { condition_percent, equipped, slot_type, quantity } = req.body; const updates = {}; if (condition_percent !== undefined) updates.condition_percent = condition_percent; if (equipped !== undefined) updates.equipped = equipped; if (slot_type !== undefined) updates.slot_type = slot_type; if (quantity !== undefined) updates.quantity = quantity; const { data, error } = await supabase.from('inventory_slots').update(updates).eq('id', req.params.slotId).select('*, item:items(*, ammo_type:ammo_types(*))').single(); if (error) return res.status(500).json({ error: error.message }); if (data?.character_id) { const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', data.character_id).single(); if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: data.character_id }); } res.json(data); });

app.post('/api/master/inventory/add', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity, slot_type } = req.body;
  const st = slot_type || 'рюкзак';
  const { data: item } = await supabase.from('items').select('*').eq('id', item_id).single();
  const { data, error } = await supabase.from('inventory_slots').insert({ character_id, item_id, quantity: quantity||1, slot_type: st, equipped: false, position: 0 }).select('*, item:items(*, ammo_type:ammo_types(*))').single();
  if (error) return res.status(500).json({ error: error.message });
  if (item?.is_container && item.container_items?.length > 0) {
    const parentSlotId = data.id;
    for (const ci of item.container_items) { const { data: childItem } = await supabase.from('items').select('*').eq('id', ci.item_id).single(); if (childItem) await supabase.from('inventory_slots').insert({ character_id, item_id: ci.item_id, quantity: ci.quantity||1, slot_type: 'container', equipped: false, position: 0, parent_slot_id: parentSlotId }); }
  }
  const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', character_id).single();
  if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id });
  res.json(data);
});

app.post('/api/inventory/:slotId/mod', authMiddleware, async (req, res) => { const { mod_item_id } = req.body; const { data: slot } = await supabase.from('inventory_slots').select('*, item:items(*)').eq('id', req.params.slotId).single(); if (!slot) return res.status(404).json({ error: 'Предмет не найден' }); const { data: modItem } = await supabase.from('items').select('*').eq('id', mod_item_id).single(); if (!modItem || modItem.slot !== 'mod') return res.status(400).json({ error: 'Это не модификация' }); if (modItem.mod_target !== 'any' && modItem.mod_target !== slot.item?.slot) return res.status(400).json({ error: 'Модификация не подходит к этому типу предмета' }); if (modItem.mod_target === 'weapon' && modItem.weapon_mod_subtype && modItem.weapon_mod_subtype !== 'any' && modItem.weapon_mod_subtype !== slot.item?.weapon_type) return res.status(400).json({ error: 'Модификация не подходит к этому типу оружия' }); const mods = slot.mods||[]; if (mods.find(m=>m.id===modItem.id)) return res.status(400).json({ error: 'Модификация уже установлена' }); mods.push({ id: modItem.id, name: modItem.name, description: modItem.description }); const { data, error } = await supabase.from('inventory_slots').update({ mods }).eq('id', req.params.slotId).select('*, item:items(*, ammo_type:ammo_types(*))').single(); if (error) return res.status(500).json({ error: error.message }); if (data?.character_id) { const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', data.character_id).single(); if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: data.character_id }); } res.json(data); });
app.delete('/api/inventory/:slotId/mod/:modItemId', authMiddleware, async (req, res) => { const { data: slot } = await supabase.from('inventory_slots').select('*').eq('id', req.params.slotId).single(); if (!slot) return res.status(404).json({ error: 'Предмет не найден' }); const mods = (slot.mods||[]).filter(m=>m.id !== req.params.modItemId); const { data, error } = await supabase.from('inventory_slots').update({ mods }).eq('id', req.params.slotId).select('*, item:items(*, ammo_type:ammo_types(*))').single(); if (error) return res.status(500).json({ error: error.message }); if (data?.character_id) { const { data: ch } = await supabase.from('characters').select('campaign_id').eq('id', data.character_id).single(); if (ch?.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id: data.character_id }); } res.json(data); });

// ===== NPC =====
app.get('/api/npcs', authMiddleware, async (req, res) => { const { campaign_id, is_template } = req.query; let q = supabase.from('npcs').select('*'); if (campaign_id) q = q.eq('campaign_id', campaign_id); if (is_template) q = q.eq('is_template', true); const { data } = await q; res.json(data||[]); });
app.post('/api/npcs', authMiddleware, async (req, res) => { const { data, error } = await supabase.from('npcs').insert(req.body).select().single(); if (error) return res.status(500).json({ error: error.message }); if (data?.campaign_id) notifyCampaign(data.campaign_id, 'npcs_updated', { campaign_id: data.campaign_id }); res.json(data); });
app.put('/api/npcs/:id', authMiddleware, async (req, res) => { const { data: existing } = await supabase.from('npcs').select('campaign_id').eq('id', req.params.id).single(); const { data, error } = await supabase.from('npcs').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); const cid = data?.campaign_id||existing?.campaign_id; if (cid) notifyCampaign(cid, 'npcs_updated', { campaign_id: cid }); res.json(data); });
app.delete('/api/npcs/:id', authMiddleware, async (req, res) => { const { data: existing } = await supabase.from('npcs').select('campaign_id').eq('id', req.params.id).single(); await supabase.from('npcs').delete().eq('id', req.params.id); if (existing?.campaign_id) notifyCampaign(existing.campaign_id, 'npcs_updated', { campaign_id: existing.campaign_id }); res.json({ success: true }); });
app.post('/api/npcs/:id/clone', authMiddleware, async (req, res) => { const { data: orig } = await supabase.from('npcs').select('*').eq('id', req.params.id).single(); if (!orig) return res.status(404).json({ error: 'Не найден' }); const { data: clone, error } = await supabase.from('npcs').insert({ name: req.body.name||`${orig.name} (копия)`, type: orig.type, health_thresholds: orig.health_thresholds, skills: orig.skills, special_properties: orig.special_properties, visibility: orig.visibility, campaign_id: orig.campaign_id, is_template: false }).select().single(); if (error) return res.status(500).json({ error: error.message }); if (clone?.campaign_id) notifyCampaign(clone.campaign_id, 'npcs_updated', { campaign_id: clone.campaign_id }); res.json(clone); });
app.post('/api/npcs/:id/roll', authMiddleware, validate(schemas.npcRoll), async (req, res) => { const { data: npc } = await supabase.from('npcs').select('*').eq('id', req.params.id).single(); if (!npc) return res.status(404).json({ error: 'Не найден' }); const skill = (npc.skills||[]).find(s=>s.name===req.body.skill_name); if (!skill) return res.status(404).json({ error: 'Навык не найден' }); const mod = skill.modifier||0; const d20 = Math.floor(Math.random()*20)+1; res.json({ npc_name: npc.name, skill_name: req.body.skill_name, d20roll: d20, modifier: mod, sum: d20+mod, formula: `d20 (${d20}) + ${mod}` }); });

// ===== ITEMS =====
app.get('/api/items', authMiddleware, async (req, res) => { const { data } = await supabase.from('items').select('*, ammo_type:ammo_types(*)').order('name'); res.json(data); });
app.post('/api/items', authMiddleware, validate(schemas.createItem), async (req, res) => { const { data, error } = await supabase.from('items').insert(req.body).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });

// ===== DICE =====
app.post('/api/dice/auto', authMiddleware, diceLimiter, validate(schemas.diceAuto), async (req, res) => { const { character_id, skill_name } = req.body; const { data: ch } = await supabase.from('characters').select('*').eq('id', character_id).single(); if (!ch) return res.status(404).json({ error: 'Не найден' }); const [{ data: cs }, { data: cp }, { data: skills }] = await Promise.all([ supabase.from('character_skills').select('skill_id, modifier').eq('character_id', character_id), supabase.from('character_perks').select('perk_id').eq('character_id', character_id), supabase.from('skills').select('*') ]); const skill = skills?.find(s=>s.name===skill_name); if (!skill) return res.status(404).json({ error: 'Навык не найден' }); const baseModifier = (cs||[]).find(e=>e.skill_id===skill.id)?.modifier||0; const pIds = (cp||[]).map(x=>x.perk_id); let perkBonus = 0; if (pIds.length) { const { data: perks } = await supabase.from('perks').select('*').in('id', pIds); for (const p of (perks||[])) for (const m of (p.effect_modifiers||[])) if (m.skill===skill_name) perkBonus += m.modifier||0; } const totalPercent = baseModifier + perkBonus; const d20 = Math.floor(Math.random()*20)+1; const bonus = Math.round(20*totalPercent/100); const sum = d20+bonus; res.json({ character_id, skill_name, d20roll: d20, baseModifier, perkBonus, totalPercent, bonus, sum, formula: `d20 (${d20}) + ${bonus} (${totalPercent}%)` }); });

// ===== CHAT =====
app.get('/api/chat/:campaign_id', authMiddleware, async (req, res) => { const { data } = await supabase.from('chat_messages').select('*').eq('campaign_id', req.params.campaign_id).order('created_at', { ascending: false }).limit(60); res.json((data||[]).reverse()); });
app.post('/api/chat/:campaign_id', authMiddleware, chatLimiter, validate(schemas.sendMessage), async (req, res) => { const { text, is_roll } = req.body; const { data, error } = await supabase.from('chat_messages').insert({ campaign_id: req.params.campaign_id, user_id: req.user.id, username: req.user.username, text, is_roll: is_roll||false }).select().single(); if (error) return res.status(500).json({ error: error.message }); notifyCampaign(req.params.campaign_id, 'chat_message', data); res.json(data); });

// ===== SCENES =====
app.get('/api/scenes/:campaign_id', authMiddleware, async (req, res) => { const { type } = req.query; const query = supabase.from('scenes').select('*').eq('campaign_id', req.params.campaign_id); if (type) query.eq('scene_type', type); const { data } = await query; res.json(data||[]); });
app.put('/api/scenes/:campaign_id', authMiddleware, validate(schemas.updateScene), async (req, res) => { const { scene_type, background_url, fog_of_war, tokens, drawings, portals } = req.body; const { data: existing } = await supabase.from('scenes').select('id').eq('campaign_id', req.params.campaign_id).eq('scene_type', scene_type).single(); if (existing) { const updates = {}; if (background_url!==undefined) updates.background_url=background_url; if (tokens!==undefined) updates.tokens=tokens; if (drawings!==undefined) updates.drawings=drawings; if (portals!==undefined) updates.portals=portals; const { data, error } = await supabase.from('scenes').update(updates).eq('id', existing.id).select().single(); if (error) return res.status(500).json({ error: error.message }); return res.json(data); } else { const { data, error } = await supabase.from('scenes').insert({ campaign_id: req.params.campaign_id, scene_type, background_url: background_url||null, fog_of_war: fog_of_war||[], tokens: tokens||[], drawings: drawings||[], portals: portals||[] }).select().single(); if (error) return res.status(500).json({ error: error.message }); return res.json(data); } });

// ===== BACKGROUNDS =====
app.post('/api/upload/background', authMiddleware, async (req, res) => { const { campaign_id, name, url, is_global } = req.body; if (!url) return res.status(400).json({ error: 'url обязателен' }); const { data, error } = await supabase.from('backgrounds').insert({ campaign_id: is_global ? null : campaign_id, name, url, is_global: is_global||false }).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.get('/api/backgrounds/:campaign_id', authMiddleware, async (req, res) => { const { data } = await supabase.from('backgrounds').select('*').or(`campaign_id.eq.${req.params.campaign_id},is_global.eq.true`).order('name'); res.json(data||[]); });

// ===== UPLOAD (IMGBB ДЛЯ КАРТИНОК) =====
app.post('/api/upload/file', authMiddleware, validate(schemas.uploadFile), async (req, res) => { const { image, name, campaign_id } = req.body; try { const formData = new URLSearchParams(); formData.append('key', process.env.IMGBB_API_KEY); formData.append('image', image); const response = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData }); const result = await response.json(); if (result.success) { const url = result.data.url; if (campaign_id) await supabase.from('backgrounds').insert({ campaign_id, name, url }); res.json({ url, name, success: true }); } else res.status(500).json({ error: 'Ошибка загрузки на ImgBB' }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ===== UPLOAD (CLOUDINARY ДЛЯ ЗВУКОВ) =====
app.post('/api/upload/sound', authMiddleware, validate(schemas.uploadSound), async (req, res) => { const { sound_data, name, campaign_id, is_global } = req.body; try { const result = await cloudinary.uploader.upload(sound_data, { folder: 'apostol-sounds', public_id: name.replace(/\.[^.]+$/, ''), resource_type: 'auto' }); const url = result.secure_url; if (campaign_id || is_global) { await supabase.from('sounds').insert({ campaign_id: is_global ? null : campaign_id, name, file_url: url, source_type: 'upload', duration: result.duration || 0, category: 'общее', is_global: is_global || false }); } res.json({ url, name, duration: result.duration, success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ===== NOTES =====
app.get('/api/notes/:campaign_id', authMiddleware, async (req, res) => { const { data } = await supabase.from('master_notes').select('*').eq('campaign_id', req.params.campaign_id).order('order_index').order('created_at', { ascending: false }); res.json(data||[]); });
app.post('/api/notes', authMiddleware, async (req, res) => { const { campaign_id, parent_id, title, content, image_url, tags, world, region, city, location, is_pinned } = req.body; const { data, error } = await supabase.from('master_notes').insert({ campaign_id, parent_id: parent_id||null, title, content: content||'', image_url, tags: tags||[], world, region, city, location, is_pinned: is_pinned||false }).select().single(); if (error) return res.status(500).json({ error: error.message }); if (campaign_id) notifyCampaign(campaign_id, 'notes_updated', { campaign_id }); res.json(data); });
app.put('/api/notes/:id', authMiddleware, async (req, res) => { const { title, content, image_url, tags, world, region, city, location, is_pinned, parent_id } = req.body; const updates = {}; if (title!==undefined) updates.title=title; if (content!==undefined) updates.content=content; if (image_url!==undefined) updates.image_url=image_url; if (tags!==undefined) updates.tags=tags; if (world!==undefined) updates.world=world; if (region!==undefined) updates.region=region; if (city!==undefined) updates.city=city; if (location!==undefined) updates.location=location; if (is_pinned!==undefined) updates.is_pinned=is_pinned; if (parent_id!==undefined) updates.parent_id=parent_id; updates.updated_at = new Date(); const { data, error } = await supabase.from('master_notes').update(updates).eq('id', req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); if (data?.campaign_id) notifyCampaign(data.campaign_id, 'notes_updated', { campaign_id: data.campaign_id }); res.json(data); });
app.delete('/api/notes/:id', authMiddleware, async (req, res) => { const { data: note } = await supabase.from('master_notes').select('campaign_id').eq('id', req.params.id).single(); await supabase.from('master_notes').delete().eq('id', req.params.id); if (note?.campaign_id) notifyCampaign(note.campaign_id, 'notes_updated', { campaign_id: note.campaign_id }); res.json({ success: true }); });

// ===== HANDOUTS =====
app.get('/api/handouts/:campaign_id', authMiddleware, async (req, res) => { const { data } = await supabase.from('handouts').select('*').eq('campaign_id', req.params.campaign_id).order('created_at', { ascending: false }); res.json(data||[]); });
app.post('/api/handouts', authMiddleware, async (req, res) => { const { campaign_id, title, content, image_url, category, is_visible } = req.body; const { data, error } = await supabase.from('handouts').insert({ campaign_id, title, content: content||'', image_url, category: category||'общее', is_visible: is_visible!==undefined?is_visible:false }).select().single(); if (error) return res.status(500).json({ error: error.message }); if (data?.campaign_id) notifyCampaign(data.campaign_id, 'handouts_updated', { campaign_id: data.campaign_id }); res.json(data); });
app.put('/api/handouts/:id', authMiddleware, async (req, res) => { const { title, content, image_url, category, is_visible } = req.body; const updates = {}; if (title!==undefined) updates.title=title; if (content!==undefined) updates.content=content; if (image_url!==undefined) updates.image_url=image_url; if (category!==undefined) updates.category=category; if (is_visible!==undefined) updates.is_visible=is_visible; const { data, error } = await supabase.from('handouts').update(updates).eq('id', req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); if (data?.campaign_id) notifyCampaign(data.campaign_id, 'handouts_updated', { campaign_id: data.campaign_id }); res.json(data); });
app.delete('/api/handouts/:id', authMiddleware, async (req, res) => { const { data: h } = await supabase.from('handouts').select('campaign_id').eq('id', req.params.id).single(); await supabase.from('handouts').delete().eq('id', req.params.id); if (h?.campaign_id) notifyCampaign(h.campaign_id, 'handouts_updated', { campaign_id: h.campaign_id }); res.json({ success: true }); });

// ===== SOUNDS =====
app.get('/api/sounds/:campaign_id', authMiddleware, async (req, res) => { const { data } = await supabase.from('sounds').select('*').or(`campaign_id.eq.${req.params.campaign_id},is_global.eq.true`).order('name'); res.json(data||[]); });
app.post('/api/sounds', authMiddleware, async (req, res) => { const { campaign_id, name, file_url, source_type, duration, category, is_global } = req.body; const { data, error } = await supabase.from('sounds').insert({ campaign_id: is_global?null:campaign_id, name, file_url, source_type: source_type||'url', duration: duration||0, category: category||'общее', is_global: is_global||false }).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/sounds/:id', authMiddleware, async (req, res) => { await supabase.from('sounds').delete().eq('id', req.params.id); res.json({ success: true }); });

// ===== SHOP =====
app.get('/api/shop', authMiddleware, async (req, res) => { const { data: presets } = await supabase.from('shop_presets').select('*').eq('is_active', true); const items = []; for (const p of (presets||[])) { for (const i of (p.items||[])) { const { data: item } = await supabase.from('items').select('*, ammo_type:ammo_types(*)').eq('id', i.item_id).single(); if (item) items.push({ ...item, shop_price: i.price_override||item.trade_price, preset_name: p.name }); } } res.json(items); });
app.get('/api/shop/presets', authMiddleware, adminMiddleware, async (req, res) => { const { data } = await supabase.from('shop_presets').select('*').order('name'); res.json(data||[]); });
app.post('/api/shop/presets', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('shop_presets').insert(req.body).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.put('/api/shop/presets/:id', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('shop_presets').update({...req.body, updated_at: new Date()}).eq('id', req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/shop/presets/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('shop_presets').delete().eq('id', req.params.id); res.json({ success: true }); });

app.post('/api/shop/buy', authMiddleware, async (req, res) => {
  const { character_id, item_id, quantity } = req.body;
  const { data: ch } = await supabase.from('characters').select('user_id, campaign_id, currency').eq('id', character_id).single();
  if (!ch || ch.user_id !== req.user.id) return res.status(403).json({ error: 'Не ваш персонаж' });
  const { data: item } = await supabase.from('items').select('*, ammo_type:ammo_types(*)').eq('id', item_id).single();
  if (!item) return res.status(404).json({ error: 'Предмет не найден' });
  const { data: presets } = await supabase.from('shop_presets').select('*').eq('is_active', true);
  let price = item.trade_price;
  for (const p of (presets||[])) { const pi = (p.items||[]).find(i => i.item_id === item_id); if (pi) { price = pi.price_override||item.trade_price; break; } }
  const totalPrice = price * (quantity||1);
  if ((ch.currency||0) < totalPrice) return res.status(400).json({ error: `Недостаточно средств. Нужно ${totalPrice}, у вас ${ch.currency||0}` });
  await supabase.from('characters').update({ currency: (ch.currency||0) - totalPrice }).eq('id', character_id);
  const { data, error } = await supabase.from('inventory_slots').insert({ character_id, item_id, quantity: quantity||1, slot_type: 'рюкзак', equipped: false }).select('*, item:items(*, ammo_type:ammo_types(*))').single();
  if (error) return res.status(500).json({ error: error.message });
  if (ch.campaign_id) notifyCampaign(ch.campaign_id, 'inventory_updated', { character_id });
  res.json({ success: true, item: data, price: totalPrice, new_balance: (ch.currency||0) - totalPrice });
});

// ===== AMMO TYPES =====
app.get('/api/ammo-types', authMiddleware, async (req, res) => { const { data } = await supabase.from('ammo_types').select('*').order('name'); res.json(data||[]); });
app.post('/api/ammo-types', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('ammo_types').insert(req.body).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.put('/api/ammo-types/:id', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('ammo_types').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/ammo-types/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('ammo_types').delete().eq('id', req.params.id); res.json({ success: true }); });

// ===== CURRENCIES =====
app.get('/api/currencies', authMiddleware, async (req, res) => { const { data } = await supabase.from('currencies').select('*').order('name'); res.json(data||[]); });
app.post('/api/currencies', authMiddleware, adminMiddleware, async (req, res) => { const { name, icon } = req.body; const { data, error } = await supabase.from('currencies').insert({ name, icon }).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/currencies/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('currencies').delete().eq('id', req.params.id); res.json({ success: true }); });

// ===== CHARACTERISTICS =====
app.get('/api/characteristics', authMiddleware, async (req, res) => { const { data } = await supabase.from('characteristics').select('*').order('name'); res.json(data || []); });
app.post('/api/characteristics', authMiddleware, adminMiddleware, async (req, res) => { const { name, short_name, description } = req.body; const { data, error } = await supabase.from('characteristics').insert({ name, short_name, description }).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.put('/api/characteristics/:id', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('characteristics').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/characteristics/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('characteristics').delete().eq('id', req.params.id); res.json({ success: true }); });

// ===== PLAYLISTS =====
app.get('/api/playlists', authMiddleware, async (req, res) => { const { data } = await supabase.from('playlists').select('*, sounds:sounds(*)').eq('is_global', true).order('name'); res.json(data || []); });
app.post('/api/playlists', authMiddleware, adminMiddleware, async (req, res) => { const { name } = req.body; const { data, error } = await supabase.from('playlists').insert({ name, is_global: true }).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.put('/api/playlists/:id', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('playlists').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/playlists/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('playlists').delete().eq('id', req.params.id); res.json({ success: true }); });

// ===== SUBCATEGORIES =====
app.get('/api/subcategories', authMiddleware, async (req, res) => { const { data } = await supabase.from('subcategories').select('*').order('name'); res.json(data || []); });
app.post('/api/subcategories', authMiddleware, adminMiddleware, async (req, res) => { const { slot, name } = req.body; const { data, error } = await supabase.from('subcategories').insert({ slot, name }).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/subcategories/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('subcategories').delete().eq('id', req.params.id); res.json({ success: true }); });

// ===== LOOT =====
app.get('/api/campaigns/:id/loot', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('loot_pools').select('*').eq('campaign_id', req.params.id).order('created_at', { ascending: false });
  res.json(data || []);
});

app.post('/api/campaigns/:id/loot', authMiddleware, async (req, res) => {
  const { name, items } = req.body;
  const { data: member } = await supabase.from('campaign_members').select('role').eq('campaign_id', req.params.id).eq('user_id', req.user.id).single();
  if (!member || !['master', 'co-master'].includes(member.role)) return res.status(403).json({ error: 'Только для Мастера' });
  const { data, error } = await supabase.from('loot_pools').insert({ campaign_id: req.params.id, name, items: items || [] }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/loot/:id', authMiddleware, async (req, res) => {
  const { name, items } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (items !== undefined) updates.items = items;
  const { data, error } = await supabase.from('loot_pools').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/loot/:id', authMiddleware, async (req, res) => {
  await supabase.from('loot_pools').delete().eq('id', req.params.id);
  res.json({ success: true });
});

app.post('/api/loot/:id/give/:characterId', authMiddleware, async (req, res) => {
  const { data: pool } = await supabase.from('loot_pools').select('*').eq('id', req.params.id).single();
  if (!pool) return res.status(404).json({ error: 'Лут-пул не найден' });
  const { data: ch } = await supabase.from('characters').select('id, campaign_id').eq('id', req.params.characterId).single();
  if (!ch) return res.status(404).json({ error: 'Персонаж не найден' });
  const { data: charPerks } = await supabase.from('character_perks').select('perk_id').eq('character_id', ch.id);
  const { data: junkPerk } = charPerks?.length ? await supabase.from('perks').select('id').in('id', charPerks.map(p => p.perk_id)).eq('name', 'Мусорщик').single() : { data: null };
  let items = pool.items || [];
  let isJunkLoot = false;
  if (junkPerk) {
    isJunkLoot = true;
    if (items.length < 3) {
      const { data: randomItems } = await supabase.from('items').select('*').limit(3 - items.length);
      for (const ri of (randomItems || [])) { items.push({ item_id: ri.id, quantity: 1 }); }
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

// ===== ADMIN =====
app.get('/api/admin/items', authMiddleware, adminMiddleware, async (req, res) => { const { data } = await supabase.from('items').select('*, ammo_type:ammo_types(*)').order('name'); res.json(data||[]); });
app.post('/api/admin/items', authMiddleware, adminMiddleware, validate(schemas.createItem), async (req, res) => { const { data, error } = await supabase.from('items').insert(req.body).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.put('/api/admin/items/:id', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('items').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/admin/items/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('items').delete().eq('id', req.params.id); res.json({ success: true }); });
app.post('/api/admin/items/batch-delete', authMiddleware, adminMiddleware, async (req, res) => { const { ids } = req.body; if (!ids?.length) return res.status(400).json({ error: 'ids обязателен' }); await supabase.from('items').delete().in('id', ids); res.json({ success: true }); });
app.put('/api/admin/items/batch-price', authMiddleware, adminMiddleware, async (req, res) => { const { ids, trade_price } = req.body; if (!ids?.length || trade_price===undefined) return res.status(400).json({ error: 'ids и trade_price обязательны' }); await supabase.from('items').update({ trade_price }).in('id', ids); res.json({ success: true }); });
app.get('/api/admin/perks', authMiddleware, adminMiddleware, async (req, res) => { const { data } = await supabase.from('perks').select('*').order('name'); res.json(data||[]); });
app.post('/api/admin/perks', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('perks').insert(req.body).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.put('/api/admin/perks/:id', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('perks').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/admin/perks/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('perks').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/api/admin/professions', authMiddleware, adminMiddleware, async (req, res) => { const { data } = await supabase.from('professions').select('*').order('name'); res.json(data||[]); });
app.post('/api/admin/professions', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('professions').insert(req.body).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.put('/api/admin/professions/:id', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('professions').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/admin/professions/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('professions').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/api/admin/skills', authMiddleware, adminMiddleware, async (req, res) => { const { data } = await supabase.from('skills').select('*, characteristic:characteristics(*)').order('name'); res.json(data||[]); });
app.post('/api/admin/skills', authMiddleware, adminMiddleware, async (req, res) => { const { name, characteristic_id } = req.body; const { data, error } = await supabase.from('skills').insert({ name, characteristic_id, is_global: true }).select('*, characteristic:characteristics(*)').single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.put('/api/admin/skills/:id', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('skills').update(req.body).eq('id', req.params.id).select('*, characteristic:characteristics(*)').single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/admin/skills/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('skills').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => { const { data } = await supabase.from('users').select('id, username, role, created_at').order('created_at', { ascending: false }); res.json(data||[]); });
app.put('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => { const { role } = req.body; if (req.user.id === req.params.id && role !== 'admin') return res.status(400).json({ error: 'Нельзя снять админа с себя' }); const { data, error } = await supabase.from('users').update({ role }).eq('id', req.params.id).select('id, username, role').single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => { if (req.user.id === req.params.id) return res.status(400).json({ error: 'Нельзя удалить себя' }); const { data: chars } = await supabase.from('characters').select('id').eq('user_id', req.params.id); for (const c of (chars||[])) { await supabase.from('inventory_slots').delete().eq('character_id', c.id); await supabase.from('character_skills').delete().eq('character_id', c.id); await supabase.from('character_perks').delete().eq('character_id', c.id); await supabase.from('characters').delete().eq('id', c.id); } await supabase.from('campaign_members').delete().eq('user_id', req.params.id); await supabase.from('users').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/api/admin/backgrounds', authMiddleware, adminMiddleware, async (req, res) => { const { data } = await supabase.from('backgrounds').select('*').eq('is_global', true).order('name'); res.json(data||[]); });
app.delete('/api/admin/backgrounds/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('backgrounds').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/api/admin/sounds', authMiddleware, adminMiddleware, async (req, res) => { const { data } = await supabase.from('sounds').select('*').eq('is_global', true).order('name'); res.json(data||[]); });
app.delete('/api/admin/sounds/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('sounds').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/api/admin/campaigns', authMiddleware, adminMiddleware, async (req, res) => { const { data } = await supabase.from('campaigns').select('*, master:users(username)').order('created_at', { ascending: false }); res.json(data || []); });
app.delete('/api/admin/campaigns/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('campaigns').delete().eq('id', req.params.id); res.json({ success: true }); });

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`APOSTOL 2.3 на порту ${PORT}`));
process.on('uncaughtException', (err) => console.error('ОШИБКА:', err.message));
process.on('unhandledRejection', (reason) => console.error('ПРОМИС:', reason));

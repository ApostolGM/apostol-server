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
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(globalLimiter);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const JWT_SECRET = process.env.JWT_SECRET;

cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });

// ===== MIDDLEWARE =====
function authMiddleware(req, res, next) { const header = req.headers.authorization; if (!header) return res.status(401).json({ error: 'Нет токена' }); try { req.user = jwt.verify(header.split(' ')[1], JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Токен недействителен' }); } }
async function adminMiddleware(req, res, next) { const { data: userData } = await supabase.from('users').select('role').eq('id', req.user.id).single(); if (!userData || userData.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' }); next(); }
function validate(schema, source = 'body') { return (req, res, next) => { const { error, value } = schema.validate(req[source], { abortEarly: false }); if (error) { const messages = error.details.map(d => d.message).join(', '); return res.status(400).json({ error: messages }); } req[source] = value; next(); }; }

const schemas = {
  register: Joi.object({ username: Joi.string().min(3).max(50).required(), password: Joi.string().min(4).max(100).required() }),
  login: Joi.object({ username: Joi.string().required(), password: Joi.string().required() }),
  createCampaign: Joi.object({ title: Joi.string().min(1).max(255).required() }),
  createCharacter: Joi.object({ campaign_id: Joi.string().uuid().required(), name: Joi.string().min(1).max(100).required(), profession_id: Joi.string().uuid().required(), perk_ids: Joi.array().items(Joi.string().uuid()) }),
  sendMessage: Joi.object({ text: Joi.string().min(1).max(2000).required(), is_roll: Joi.boolean().default(false) }),
  diceAuto: Joi.object({ character_id: Joi.string().uuid().required(), skill_name: Joi.string().required() }),
  npcRoll: Joi.object({ skill_name: Joi.string().required() }),
  updateScene: Joi.object({ scene_type: Joi.string().valid('local','global').required(), background_url: Joi.string().uri().allow(null), tokens: Joi.array(), drawings: Joi.array(), portals: Joi.array() }),
  uploadFile: Joi.object({ image: Joi.string().max(50*1024*1024).required(), name: Joi.string().required(), campaign_id: Joi.string().uuid() }),
  uploadSound: Joi.object({ sound_data: Joi.string().required(), name: Joi.string().required(), campaign_id: Joi.string().uuid().allow(null), is_global: Joi.boolean().default(false) }),
  createItem: Joi.object({ name: Joi.string().required(), slot: Joi.string().required(), subcategory: Joi.string().allow('', null), icon: Joi.string().allow('', null), weight: Joi.number().min(0), condition_percent: Joi.number().min(0).max(100), description: Joi.string().allow(''), trade_price: Joi.number().min(0), weapon_type: Joi.string().valid('melee','ranged','thrown').allow(null), max_ammo: Joi.number().min(0), is_heavy: Joi.boolean(), ammo_type_id: Joi.string().uuid().allow(null), accepted_ammo_types: Joi.array().items(Joi.string().uuid()), mod_target: Joi.string().valid('weapon','armor','exo','any').allow(null), weapon_mod_subtype: Joi.string().valid('melee','ranged','thrown','any').allow(null), is_global: Joi.boolean().default(true), is_container: Joi.boolean().default(false), container_slots: Joi.number().integer().min(0).default(0), container_items: Joi.array().items(Joi.object({ item_id: Joi.string().uuid().required(), quantity: Joi.number().integer().min(1).default(1) })).default([]) }),
};

async function enrichCharacter(ch) { /* без изменений */ }
function getWeightPenalty(percent) { /* без изменений */ }
function notifyCampaign(campaignId, event, data) { io.to(`campaign:${campaignId}`).emit(event, data); }

// ===== SOCKET.IO =====
const activeUsers = new Map();
io.on('connection', (socket) => { /* без изменений */ });

// ===== AUTH =====
app.post('/api/auth/register', authLimiter, validate(schemas.register), async (req, res) => { /* без изменений */ });
app.post('/api/auth/login', authLimiter, validate(schemas.login), async (req, res) => { /* без изменений */ });
app.get('/api/auth/me', authMiddleware, async (req, res) => { /* без изменений */ });

// ===== CAMPAIGNS =====
app.post('/api/campaigns', authMiddleware, adminMiddleware, validate(schemas.createCampaign), async (req, res) => { /* без изменений */ });
app.post('/api/campaigns/join/:code', authMiddleware, async (req, res) => { /* без изменений */ });
app.get('/api/campaigns', authMiddleware, async (req, res) => { /* без изменений */ });
app.get('/api/campaigns/:id', authMiddleware, async (req, res) => { /* без изменений */ });
app.put('/api/campaigns/:id/time', authMiddleware, async (req, res) => { /* без изменений */ });
app.delete('/api/campaigns/:id/members/:userId', authMiddleware, async (req, res) => { /* без изменений */ });

// ===== CHARACTERS =====
app.get('/api/campaigns/:id/characters', authMiddleware, async (req, res) => { /* без изменений */ });
app.get('/api/professions', authMiddleware, async (req, res) => { /* без изменений */ });
app.get('/api/perks', authMiddleware, async (req, res) => { /* без изменений */ });
app.get('/api/skills', authMiddleware, async (req, res) => { const { data } = await supabase.from('skills').select('*, characteristic:characteristics(*)').eq('is_global', true); res.json(data); });
app.post('/api/characters', authMiddleware, validate(schemas.createCharacter), async (req, res) => { /* без изменений */ });
app.get('/api/characters/:id', authMiddleware, async (req, res) => { /* без изменений */ });
app.put('/api/characters/:id/params', authMiddleware, async (req, res) => { /* без изменений */ });
app.delete('/api/characters/:id', authMiddleware, async (req, res) => { /* без изменений */ });

// ===== CHARACTER SKILLS =====
app.post('/api/characters/:id/skills', authMiddleware, async (req, res) => { /* без изменений */ });
app.put('/api/characters/:id/skills/:skillId', authMiddleware, async (req, res) => { /* без изменений */ });
app.delete('/api/characters/:id/skills/:skillId', authMiddleware, async (req, res) => { /* без изменений */ });

// ===== INVENTORY =====
app.get('/api/characters/:id/weight', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/inventory/add', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/inventory/remove', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/inventory/equip', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/inventory/unequip', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/inventory/use', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/inventory/reload', authMiddleware, async (req, res) => { /* без изменений */ });
app.put('/api/inventory/:slotId', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/master/inventory/add', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/inventory/:slotId/mod', authMiddleware, async (req, res) => { /* без изменений */ });
app.delete('/api/inventory/:slotId/mod/:modItemId', authMiddleware, async (req, res) => { /* без изменений */ });

// ===== NPC =====
app.get('/api/npcs', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/npcs', authMiddleware, async (req, res) => { /* без изменений */ });
app.put('/api/npcs/:id', authMiddleware, async (req, res) => { /* без изменений */ });
app.delete('/api/npcs/:id', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/npcs/:id/clone', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/npcs/:id/roll', authMiddleware, validate(schemas.npcRoll), async (req, res) => { /* без изменений */ });

// ===== ITEMS =====
app.get('/api/items', authMiddleware, async (req, res) => { const { data } = await supabase.from('items').select('*, ammo_type:ammo_types(*)').order('name'); res.json(data); });
app.post('/api/items', authMiddleware, validate(schemas.createItem), async (req, res) => { const { data, error } = await supabase.from('items').insert(req.body).select().single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });

// ===== DICE =====
app.post('/api/dice/auto', authMiddleware, diceLimiter, validate(schemas.diceAuto), async (req, res) => { /* без изменений */ });

// ===== CHAT =====
app.get('/api/chat/:campaign_id', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/chat/:campaign_id', authMiddleware, chatLimiter, validate(schemas.sendMessage), async (req, res) => { /* без изменений */ });

// ===== SCENES =====
app.get('/api/scenes/:campaign_id', authMiddleware, async (req, res) => { /* без изменений */ });
app.put('/api/scenes/:campaign_id', authMiddleware, validate(schemas.updateScene), async (req, res) => { /* без изменений */ });

// ===== BACKGROUNDS =====
app.post('/api/upload/background', authMiddleware, async (req, res) => { /* без изменений */ });
app.get('/api/backgrounds/:campaign_id', authMiddleware, async (req, res) => { /* без изменений */ });

// ===== UPLOAD (IMGBB ДЛЯ КАРТИНОК) =====
app.post('/api/upload/file', authMiddleware, validate(schemas.uploadFile), async (req, res) => { /* без изменений */ });

// ===== UPLOAD (CLOUDINARY ДЛЯ ЗВУКОВ) =====
app.post('/api/upload/sound', authMiddleware, validate(schemas.uploadSound), async (req, res) => { /* без изменений */ });

// ===== NOTES =====
app.get('/api/notes/:campaign_id', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/notes', authMiddleware, async (req, res) => { /* без изменений */ });
app.put('/api/notes/:id', authMiddleware, async (req, res) => { /* без изменений */ });
app.delete('/api/notes/:id', authMiddleware, async (req, res) => { /* без изменений */ });

// ===== HANDOUTS =====
app.get('/api/handouts/:campaign_id', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/handouts', authMiddleware, async (req, res) => { /* без изменений */ });
app.put('/api/handouts/:id', authMiddleware, async (req, res) => { /* без изменений */ });
app.delete('/api/handouts/:id', authMiddleware, async (req, res) => { /* без изменений */ });

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
app.get('/api/ammo-types', authMiddleware, async (req, res) => { /* без изменений */ });
app.post('/api/ammo-types', authMiddleware, adminMiddleware, async (req, res) => { /* без изменений */ });
app.put('/api/ammo-types/:id', authMiddleware, adminMiddleware, async (req, res) => { /* без изменений */ });
app.delete('/api/ammo-types/:id', authMiddleware, adminMiddleware, async (req, res) => { /* без изменений */ });

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
app.post('/api/admin/skills', authMiddleware, adminMiddleware, async (req, res) => { const { name, characteristic_id, is_global } = req.body; const { data, error } = await supabase.from('skills').insert({ name, characteristic_id, is_global: is_global !== false }).select('*, characteristic:characteristics(*)').single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.put('/api/admin/skills/:id', authMiddleware, adminMiddleware, async (req, res) => { const { data, error } = await supabase.from('skills').update(req.body).eq('id', req.params.id).select('*, characteristic:characteristics(*)').single(); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.delete('/api/admin/skills/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('skills').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => { /* без изменений */ });
app.put('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => { /* без изменений */ });
app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => { /* без изменений */ });
app.get('/api/admin/backgrounds', authMiddleware, adminMiddleware, async (req, res) => { /* без изменений */ });
app.delete('/api/admin/backgrounds/:id', authMiddleware, adminMiddleware, async (req, res) => { /* без изменений */ });
app.get('/api/admin/sounds', authMiddleware, adminMiddleware, async (req, res) => { const { data } = await supabase.from('sounds').select('*').eq('is_global', true).order('name'); res.json(data||[]); });
app.delete('/api/admin/sounds/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('sounds').delete().eq('id', req.params.id); res.json({ success: true }); });
app.get('/api/admin/campaigns', authMiddleware, adminMiddleware, async (req, res) => { const { data } = await supabase.from('campaigns').select('*, master:users(username)').order('created_at', { ascending: false }); res.json(data || []); });
app.delete('/api/admin/campaigns/:id', authMiddleware, adminMiddleware, async (req, res) => { await supabase.from('campaigns').delete().eq('id', req.params.id); res.json({ success: true }); });

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`APOSTOL 2.3 на порту ${PORT}`));
process.on('uncaughtException', (err) => console.error('ОШИБКА:', err.message));
process.on('unhandledRejection', (reason) => console.error('ПРОМИС:', reason));

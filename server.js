import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const app = express();
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
  if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
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
  const { data: campaigns } = await supabase.from('campaigns').select('*').in('id', ids);
  res.json(campaigns);
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

  // Получаем профессию
  const { data: profession } = await supabase.from('professions').select('*').eq('id', profession_id).single();
  if (!profession) return res.status(400).json({ error: 'Профессия не найдена' });

  // Считаем стоимость перков
  let balancePoints = 10;
  if (perk_ids && perk_ids.length > 0) {
    const { data: perks } = await supabase.from('perks').select('*').in('id', perk_ids);
    for (const perk of perks) {
      balancePoints += perk.cost; // cost отрицательный для позитивных (тратят очки), положительный для негативных (дают очки)
    }
  }
  if (balancePoints < 0) return res.status(400).json({ error: `Не хватает очков распределения. Баланс: ${balancePoints}` });

  // Создаём персонажа
  const { data: character, error } = await supabase.from('characters').insert({
    user_id: req.user.id,
    campaign_id,
    name,
    profession_id,
    balance_points: balancePoints,
    food: 100,
    water: 100,
    stress: 0
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Добавляем стартовые навыки из профессии
  const starterSkills = profession.starter_skills || [];
  for (const ss of starterSkills) {
    const { data: skillData } = await supabase.from('skills').select('id').eq('name', ss.skill).single();
    if (skillData) {
      await supabase.from('character_skills').insert({
        character_id: character.id,
        skill_id: skillData.id,
        modifier: ss.modifier
      });
    }
  }

  // Добавляем перки
  if (perk_ids && perk_ids.length > 0) {
    for (const perk_id of perk_ids) {
      await supabase.from('character_perks').insert({ character_id: character.id, perk_id });
    }
  }

  // Привязываем персонажа к члену кампании
  await supabase.from('campaign_members').update({ character_id: character.id }).eq('campaign_id', campaign_id).eq('user_id', req.user.id);

  res.json(character);
});

app.get('/api/characters/:id', authMiddleware, async (req, res) => {
  const { data: character } = await supabase.from('characters').select('*').eq('id', req.params.id).single();
  if (!character) return res.status(404).json({ error: 'Персонаж не найден' });

  // Получаем профессию
  const { data: profession } = await supabase.from('professions').select('*').eq('id', character.profession_id).single();

  // Получаем перки
  const { data: cp } = await supabase.from('character_perks').select('perk_id').eq('character_id', character.id);
  const perkIds = cp.map(p => p.perk_id);
  let perks = [];
  if (perkIds.length > 0) {
    const { data } = await supabase.from('perks').select('*').in('id', perkIds);
    perks = data;
  }

  // Получаем навыки
  const { data: cs } = await supabase.from('character_skills').select('skill_id, modifier').eq('character_id', character.id);
  const skillIds = cs.map(s => s.skill_id);
  let skills = [];
  if (skillIds.length > 0) {
    const { data: skillsData } = await supabase.from('skills').select('*').in('id', skillIds);
    skills = skillsData.map(s => {
      const csEntry = cs.find(e => e.skill_id === s.id);
      return { ...s, modifier: csEntry?.modifier || 0 };
    });
  }

  res.json({ ...character, profession, perks, skills });
});

// Обновление параметров персонажа (Мастер)
app.put('/api/characters/:id/params', authMiddleware, async (req, res) => {
  const { food, water, stress, game_time_date, game_time_hours, game_time_minutes, carry_weight_max } = req.body;
  const updates = {};
  if (food !== undefined) updates.food = food;
  if (water !== undefined) updates.water = water;
  if (stress !== undefined) updates.stress = stress;
  if (game_time_date !== undefined) updates.game_time_date = game_time_date;
  if (game_time_hours !== undefined) updates.game_time_hours = game_time_hours;
  if (game_time_minutes !== undefined) updates.game_time_minutes = game_time_minutes;
  if (carry_weight_max !== undefined) updates.carry_weight_max = carry_weight_max;

  const { data, error } = await supabase.from('characters').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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

// ===== ЗДОРОВЬЕ =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`APOSTOL сервер запущен на порту ${PORT}`);
});

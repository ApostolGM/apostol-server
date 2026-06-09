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

// Middleware проверки токена
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
  const { data: user, error } = await supabase.from('users').insert({
    username,
    password_hash: hash
  }).select('id, username, avatar_url').single();

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

  const { data: campaign, error } = await supabase.from('campaigns').insert({
    title,
    master_id: req.user.id,
    invite_code
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('campaign_members').insert({
    campaign_id: campaign.id,
    user_id: req.user.id,
    role: 'master'
  });

  await supabase.from('scenes').insert({ campaign_id: campaign.id });

  res.json(campaign);
});

app.post('/api/campaigns/join/:code', authMiddleware, async (req, res) => {
  const { data: campaign } = await supabase.from('campaigns').select('*').eq('invite_code', req.params.code).single();
  if (!campaign) return res.status(404).json({ error: 'Кампания не найдена' });

  const { data: existing } = await supabase.from('campaign_members').select('id').eq('campaign_id', campaign.id).eq('user_id', req.user.id).single();
  if (existing) return res.status(409).json({ error: 'Вы уже в этой кампании' });

  await supabase.from('campaign_members').insert({
    campaign_id: campaign.id,
    user_id: req.user.id,
    role: 'player'
  });

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

// ===== ЗДОРОВЬЕ СЕРВЕРА =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`APOSTOL сервер запущен на порту ${PORT}`);
});

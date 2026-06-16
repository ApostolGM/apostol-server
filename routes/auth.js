// routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';
import { authMiddleware, authLimiter, validate, schemas } from '../middleware.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

// POST /api/auth/register
router.post('/register', authLimiter, validate(schemas.register), async (req, res) => {
  const { username, password } = req.body;
  const { data: ex } = await supabase.from('users').select('id').eq('username', username).single();
  if (ex) return res.status(409).json({ error: 'Пользователь уже существует' });

  const hash = await bcrypt.hash(password, 10);
  const { data: user, error } = await supabase.from('users')
    .insert({ username, password_hash: hash, role: 'player' })
    .select('id, username, avatar_url, role').single();

  if (error) return res.status(500).json({ error: error.message });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ user, token });
});

// POST /api/auth/login
router.post('/login', authLimiter, validate(schemas.login), async (req, res) => {
  const { username, password } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    user: { id: user.id, username: user.username, avatar_url: user.avatar_url, role: user.role },
    token
  });
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  const { data: user } = await supabase.from('users')
    .select('id, username, avatar_url, role').eq('id', req.user.id).single();
  res.json(user);
});

export default router;

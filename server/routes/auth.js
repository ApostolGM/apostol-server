// routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';

const router = Router();

router.post('/register', validate(schemas.register), async (req, res) => {
  const { username, password } = req.body;
  const { data: ex } = await supabase
    .from('users')
    .select('id')
    .eq('username', username)
    .single();
  if (ex) return res.status(409).json({ error: 'Пользователь уже существует' });

  const hash = await bcrypt.hash(password, 10);
  const { data: user, error } = await supabase
    .from('users')
    .insert({ username, password_hash: hash, role: 'player' })
    .select('id, username, avatar_url, role')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  const token = jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({ user, token });
});

router.post('/login', validate(schemas.login), async (req, res) => {
  const { username, password } = req.body;
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .single();
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({
    user: {
      id: user.id,
      username: user.username,
      avatar_url: user.avatar_url,
      role: user.role,
    },
    token,
  });
});

router.get('/me', authMiddleware, async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, username, avatar_url, role')
    .eq('id', req.user.id)
    .single();
  res.json(user);
});

export default router;

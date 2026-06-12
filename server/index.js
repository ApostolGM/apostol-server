import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { createClient } from '@supabase/supabase-js';
import rateLimit from 'express-rate-limit';
import { setupSocket } from './socket/index.js';
import authRoutes from './routes/auth.js';
import campaignRoutes from './routes/campaigns.js';
import characterRoutes from './routes/characters.js';
import characterSkillRoutes from './routes/characterSkills.js';
import inventoryRoutes from './routes/inventory.js';
import masterInventoryRoutes from './routes/masterInventory.js';
import npcRoutes from './routes/npc.js';
import itemRoutes from './routes/items.js';
import diceRoutes from './routes/dice.js';
import chatRoutes from './routes/chat.js';
import sceneRoutes from './routes/scenes.js';
import backgroundRoutes from './routes/backgrounds.js';
import uploadRoutes from './routes/upload.js';
import noteRoutes from './routes/notes.js';
import handoutRoutes from './routes/handouts.js';
import soundRoutes from './routes/sounds.js';
import adminRoutes from './routes/admin.js';

const requiredEnv = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET', 'IMGBB_API_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`ОШИБКА: Не задана переменная окружения ${key}`);
    process.exit(1);
  }
}

console.log('Переменные окружения загружены');

const app = express();
const httpServer = createServer(app);

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('Supabase подключён');

let io;
try {
  io = setupSocket(httpServer);
  console.log('Socket.IO настроен');
} catch (e) {
  console.error('ОШИБКА Socket.IO:', e.message);
  process.exit(1);
}

app.set('io', io);
app.set('supabase', supabase);

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Слишком много запросов' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток' },
});

app.use(cors({
  origin: 'https://apostol.onrender.com',
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(globalLimiter);

console.log('Middleware подключён');

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/characters', characterSkillRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/master/inventory', masterInventoryRoutes);
app.use('/api/npcs', npcRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/dice', diceRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/scenes', sceneRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/backgrounds', backgroundRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/handouts', handoutRoutes);
app.use('/api/sounds', soundRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

console.log('Роуты подключены');

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`APOSTOL 2.0 на порту ${PORT}`));

process.on('uncaughtException', (err) => {
  console.error('НЕОБРАБОТАННАЯ ОШИБКА:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('НЕОБРАБОТАННЫЙ ПРОМИС:', reason);
  process.exit(1);
});
// server.js — точка входа APOSTOL 2.0
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { supabase } from './config/supabase.js';
import { globalLimiter, authMiddleware } from './middleware.js';
import { setupSocket } from './socket.js';

// Роуты
import authRoutes from './routes/auth.js';
import campaignRoutes from './routes/campaigns.js';
import characterRoutes from './routes/characters.js';
import inventoryRoutes from './routes/inventory.js';
import masterRoutes from './routes/master.js';
import lootRoutes from './routes/loot.js';
import npcRoutes from './routes/npc.js';
import itemRoutes from './routes/items.js';
import diceRoutes from './routes/dice.js';
import chatRoutes from './routes/chat.js';
import sceneRoutes from './routes/scenes.js';
import noteRoutes from './routes/notes.js';
import handoutRoutes from './routes/handouts.js';
import soundRoutes from './routes/sounds.js';
import shopRoutes from './routes/shop.js';
import uploadRoutes from './routes/upload.js';
import adminRoutes from './routes/admin.js';
import ammoRoutes from './routes/ammo.js';
import currencyRoutes from './routes/currencies.js';
import characteristicRoutes from './routes/characteristics.js';
import playlistRoutes from './routes/playlists.js';
import subcategoryRoutes from './routes/subcategories.js';
import backgroundRoutes from './routes/backgrounds.js';
import professionRoutes from './routes/professions.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }
});

app.use(cors({
  origin: '*',
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});
app.use(express.json({ limit: '50mb' }));
app.use(globalLimiter);

// Монтируем роуты
app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/loot', lootRoutes);
app.use('/api/npcs', npcRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/dice', diceRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/scenes', sceneRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/handouts', handoutRoutes);
app.use('/api/sounds', soundRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ammo-types', ammoRoutes);
app.use('/api/currencies', currencyRoutes);
app.use('/api/characteristics', characteristicRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/subcategories', subcategoryRoutes);
app.use('/api/backgrounds', backgroundRoutes);
app.use('/api/professions', professionRoutes);

// Публичные эндпоинты
app.get('/api/perks', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('perks').select('*').order('name');
  res.json(data || []);
});

app.get('/api/skills', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('skills').select('*, characteristic:characteristics(*)').order('name');
  res.json(data || []);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Socket.IO
setupSocket(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`APOSTOL 2.0 на порту ${PORT}`));

process.on('uncaughtException', (err) => console.error('ОШИБКА:', err.message));
process.on('unhandledRejection', (reason) => console.error('ПРОМИС:', reason));

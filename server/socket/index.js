// server/server/socket/index.js
import { Server } from 'socket.io';
import { handleChat } from './handlers/chat.js';
import { handleScene } from './handlers/scene.js';
import { handleSound } from './handlers/sound.js';

export function setupSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: 'https://apostol.onrender.com',
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    },
  });

  const activeUsers = new Map();

  io.on('connection', (socket) => {
    socket.on('join_campaign', ({ userId, campaignId }) => {
      socket.join(`campaign:${campaignId}`);
      activeUsers.set(userId, { socketId: socket.id, campaignId });
    });

    socket.on('leave_campaign', ({ userId }) => {
      const u = activeUsers.get(userId);
      if (u) {
        socket.leave(`campaign:${u.campaignId}`);
        activeUsers.delete(userId);
      }
    });

    socket.on('set_role', (role) => {
      socket.data.role = role;
    });

    socket.on('disconnect', () => {
      for (const [uid, d] of activeUsers.entries()) {
        if (d.socketId === socket.id) {
          activeUsers.delete(uid);
          break;
        }
      }
    });

    handleChat(io, socket);
    handleScene(io, socket);
    handleSound(io, socket);
  });

  return io;
}

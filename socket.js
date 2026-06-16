// socket.js — все сокет-события
import { supabase } from './config/supabase.js';
import { createNotify } from './notify.js';

const activeUsers = new Map();
let notifyCampaign;

export function setupSocket(io) {
  notifyCampaign = createNotify(io);

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

    socket.on('dice_roll', (data) => {
      const payload = { ...data, time: new Date().toISOString() };
      if (data.hidden) {
        const room = io.sockets.adapter.rooms.get(`campaign:${data.campaignId}`);
        if (room) {
          for (const sid of room) {
            const s = io.sockets.sockets.get(sid);
            if (s?.data?.role && ['master', 'co-master'].includes(s.data.role)) {
              s.emit('dice_result', payload);
            }
          }
        }
        socket.emit('dice_result', payload);
      } else {
        io.to(`campaign:${data.campaignId}`).emit('dice_result', payload);
      }
    });

    socket.on('scene_token_move', (data) => {
      socket.to(`campaign:${data.campaignId}`).emit('scene_token_moved', data);
    });

    socket.on('scene_update', (data) => {
      socket.to(`campaign:${data.campaignId}`).emit('scene_updated', data);
    });

    socket.on('scene_drawings', (data) => {
      socket.to(`campaign:${data.campaignId}`).emit('scene_drawings', data);
    });

    socket.on('scene_portals', (data) => {
      socket.to(`campaign:${data.campaignId}`).emit('scene_portals', data);
    });

    socket.on('sound_play', (data) => {
      socket.to(`campaign:${data.campaignId}`).emit('sound_play', data);
    });

    socket.on('sound_stop', (data) => {
      socket.to(`campaign:${data.campaignId}`).emit('sound_stop', data);
    });

    socket.on('set_role', (role) => {
      socket.data.role = role;
    });

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

    socket.on('base_updated', (data) => {
      io.to(`campaign:${data.campaignId}`).emit('base_updated', data);
    });

    socket.on('disconnect', () => {
      for (const [uid, d] of activeUsers.entries()) {
        if (d.socketId === socket.id) {
          activeUsers.delete(uid);
          break;
        }
      }
    });
  });
}

export { notifyCampaign };

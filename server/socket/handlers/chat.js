// socket/handlers/chat.js
export function handleChat(io, socket) {
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
}

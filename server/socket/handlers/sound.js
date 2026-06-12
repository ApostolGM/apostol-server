// server/server/socket/handlers/sound.js
export function handleSound(io, socket) {
  socket.on('sound_play', (data) => {
    socket.to(`campaign:${data.campaignId}`).emit('sound_play', data);
  });

  socket.on('sound_stop', (data) => {
    socket.to(`campaign:${data.campaignId}`).emit('sound_stop', data);
  });
}

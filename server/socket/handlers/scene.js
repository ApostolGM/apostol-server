// socket/handlers/scene.js
export function handleScene(io, socket) {
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
}

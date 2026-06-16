// notify.js — рассылка событий по комнате кампании
import { io } from './server.js'; // Будет передан через замыкание, см. socket.js

// Экспортируем фабрику, которая принимает io
export function createNotify(ioInstance) {
  return function notifyCampaign(campaignId, event, data) {
    ioInstance.to(`campaign:${campaignId}`).emit(event, data);
  };
}

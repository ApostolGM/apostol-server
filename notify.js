// notify.js — рассылка событий по комнате кампании
export function createNotify(io) {
  return function notifyCampaign(campaignId, event, data) {
    io.to(`campaign:${campaignId}`).emit(event, data);
  };
}

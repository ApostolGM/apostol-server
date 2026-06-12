// server/server/middleware/validate.js
import Joi from 'joi';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], { abortEarly: false });
    if (error) {
      const messages = error.details.map(d => d.message).join(', ');
      return res.status(400).json({ error: messages });
    }
    req[source] = value;
    next();
  };
}

export const schemas = {
  register: Joi.object({
    username: Joi.string().min(3).max(50).required(),
    password: Joi.string().min(4).max(100).required(),
  }),
  login: Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required(),
  }),
  createCampaign: Joi.object({
    title: Joi.string().min(1).max(255).required(),
  }),
  createCharacter: Joi.object({
    campaign_id: Joi.string().uuid().required(),
    name: Joi.string().min(1).max(100).required(),
    profession_id: Joi.string().uuid().required(),
    perk_ids: Joi.array().items(Joi.string().uuid()),
  }),
  sendMessage: Joi.object({
    text: Joi.string().min(1).max(2000).required(),
    is_roll: Joi.boolean().default(false),
  }),
  diceAuto: Joi.object({
    character_id: Joi.string().uuid().required(),
    skill_name: Joi.string().required(),
  }),
  npcRoll: Joi.object({
    skill_name: Joi.string().required(),
  }),
  updateScene: Joi.object({
    scene_type: Joi.string().valid('local', 'global').required(),
    background_url: Joi.string().uri().allow(null),
    fog_of_war: Joi.array(),
    tokens: Joi.array(),
    drawings: Joi.array(),
    portals: Joi.array(),
  }),
  uploadFile: Joi.object({
    image: Joi.string().max(15 * 1024 * 1024).required(),
    name: Joi.string().required(),
    campaign_id: Joi.string().uuid(),
  }),
};

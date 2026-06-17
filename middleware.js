// middleware.js — авторизация, валидация, лимитеры
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import { supabase } from './config/supabase.js';

const JWT_SECRET = process.env.JWT_SECRET;

// ===== RATE LIMITERS =====
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Слишком много запросов' },
  standardHeaders: true,
  legacyHeaders: false
});

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток' }
});

export const chatLimiter = rateLimit({
  windowMs: 1000,
  max: 5,
  message: { error: 'Слишком много сообщений' }
});

export const diceLimiter = rateLimit({
  windowMs: 1000,
  max: 10,
  message: { error: 'Слишком много бросков' }
});

// ===== MIDDLEWARE =====
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Нет токена' });
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Токен недействителен' });
  }
}

export async function adminMiddleware(req, res, next) {
  const { data: userData } = await supabase.from('users').select('role').eq('id', req.user.id).single();
  if (!userData || userData.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  next();
}

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

// ===== JOI SCHEMAS =====
export const schemas = {
  register: Joi.object({
    username: Joi.string().min(3).max(50).required(),
    password: Joi.string().min(4).max(100).required()
  }),
  login: Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required()
  }),
  createCampaign: Joi.object({
    title: Joi.string().min(1).max(255).required()
  }),
  createCharacter: Joi.object({
    campaign_id: Joi.string().uuid().required(),
    name: Joi.string().min(1).max(100).required(),
    profession_id: Joi.string().uuid().required(),
    perk_ids: Joi.array().items(Joi.string().uuid()),
    perk_data: Joi.array().items(Joi.object({
      perk_id: Joi.string().uuid(),
      linked_perk_id: Joi.string().uuid().allow(null)
    })).optional()
  }),
  sendMessage: Joi.object({
    text: Joi.string().min(1).max(2000).required(),
    is_roll: Joi.boolean().default(false)
  }),
  diceAuto: Joi.object({
    character_id: Joi.string().uuid().required(),
    skill_name: Joi.string().required(),
    shots_count: Joi.number().integer().min(1).optional()
  }),
  npcRoll: Joi.object({
    skill_name: Joi.string().required()
  }),
  updateScene: Joi.object({
    scene_type: Joi.string().valid('local', 'global').required(),
    background_url: Joi.string().uri().allow(null),
    tokens: Joi.array(),
    drawings: Joi.array(),
    portals: Joi.array()
  }),
  uploadFile: Joi.object({
    image: Joi.string().max(50 * 1024 * 1024).required(),
    name: Joi.string().required(),
    campaign_id: Joi.string().uuid()
  }),
  uploadSound: Joi.object({
    sound_data: Joi.string().required(),
    name: Joi.string().required(),
    campaign_id: Joi.string().uuid().allow(null),
    is_global: Joi.boolean().default(false)
  }),
  createItem: Joi.object({
    name: Joi.string().required(),
    slot: Joi.string().optional(),
    item_slot_id: Joi.string().uuid().allow(null).optional(),
    subcategory: Joi.string().allow('', null).optional(),
    icon: Joi.string().allow('', null).optional(),
    weight: Joi.number().min(0).optional(),
    condition_percent: Joi.number().min(0).max(100).optional(),
    description: Joi.string().allow('').optional(),
    trade_price: Joi.number().min(0).optional(),
    weapon_type: Joi.string().valid('melee','ranged','thrown').allow(null, '').optional(),
    max_ammo: Joi.number().min(0).optional(),
    is_heavy: Joi.boolean().optional(),
    ammo_type_id: Joi.string().uuid().allow(null, '').optional(),
    accepted_ammo_types: Joi.array().items(Joi.string().uuid()).optional(),
    mod_item_slot_id: Joi.string().uuid().allow(null, '').optional(),
    is_global: Joi.boolean().default(true).optional(),
    container_items: Joi.array().items(Joi.object({
      item_id: Joi.string().uuid().required(),
      quantity: Joi.number().integer().min(1).default(1)
    })).default([]).optional(),
    linked_skill_ids: Joi.array().items(Joi.string().uuid()).default([]).optional(),
    skill_coefficients: Joi.array().items(Joi.object({
      skill_id: Joi.string().uuid().required(),
      coefficient: Joi.number().default(1.0)
    })).default([]).optional(),
    shots_per_action: Joi.number().integer().min(1).default(1).optional(),
    ammo_per_shot: Joi.number().integer().min(1).default(1).optional(),
  }),
  updateCharacterParams: Joi.object({
    carry_weight_max: Joi.number().min(0).optional(),
    currency: Joi.number().min(0).optional(),
    statuses: Joi.array().items(Joi.object({
      status_id: Joi.string().uuid().required(),
      value: Joi.number().required()
    })).optional()
  }),
};

// server/server/middleware/rateLimiter.js
import rateLimit from 'express-rate-limit';

export const chatLimiter = rateLimit({
  windowMs: 1000,
  max: 5,
  message: { error: 'Слишком много сообщений' },
});

export const diceLimiter = rateLimit({
  windowMs: 1000,
  max: 10,
  message: { error: 'Слишком много бросков' },
});

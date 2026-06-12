// routes/dice.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';
import { diceLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/auto', authMiddleware, diceLimiter, validate(schemas.diceAuto), async (req, res) => {
  const { character_id, skill_name } = req.body;

  const { data: ch } = await supabase
    .from('characters')
    .select('*')
    .eq('id', character_id)
    .single();
  if (!ch) return res.status(404).json({ error: 'Персонаж не найден' });

  const [
    { data: cs },
    { data: cp },
    { data: skills },
  ] = await Promise.all([
    supabase.from('character_skills').select('skill_id, modifier').eq('character_id', character_id),
    supabase.from('character_perks').select('perk_id').eq('character_id', character_id),
    supabase.from('skills').select('*'),
  ]);

  const skill = skills?.find(s => s.name === skill_name);
  if (!skill) return res.status(404).json({ error: 'Навык не найден' });

  const baseModifier = (cs || []).find(e => e.skill_id === skill.id)?.modifier || 0;
  const pIds = (cp || []).map(x => x.perk_id);

  let perkBonus = 0;
  if (pIds.length) {
    const { data: perks } = await supabase.from('perks').select('*').in('id', pIds);
    for (const p of perks || []) {
      for (const m of p.effect_modifiers || []) {
        if (m.skill === skill_name) perkBonus += m.modifier || 0;
      }
    }
  }

  const totalPercent = baseModifier + perkBonus;
  const d20 = Math.floor(Math.random() * 20) + 1;
  const bonus = Math.round(20 * totalPercent / 100);
  const sum = d20 + bonus;

  res.json({
    character_id,
    skill_name,
    d20roll: d20,
    baseModifier,
    perkBonus,
    totalPercent,
    bonus,
    sum,
    formula: `d20 (${d20}) + ${bonus} (${totalPercent}%)`,
  });
});

export default router;

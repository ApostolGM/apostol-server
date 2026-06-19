// routes/dice.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, diceLimiter, validate, schemas } from '../middleware.js';

const router = Router();

// POST /api/dice/auto
router.post('/auto', authMiddleware, diceLimiter, validate(schemas.diceAuto), async (req, res) => {
  const { character_id, skill_name, shots_count } = req.body;

  const { data: ch } = await supabase.from('characters').select('*').eq('id', character_id).single();
  if (!ch) return res.status(404).json({ error: 'Персонаж не найден' });

  const [{ data: cs }, { data: cp }, { data: skills }] = await Promise.all([
    supabase.from('character_skills').select('skill_id, modifier').eq('character_id', character_id),
    supabase.from('character_perks').select('perk_id').eq('character_id', character_id),
    supabase.from('skills').select('*')
  ]);

  const skill = skills?.find(s => s.name === skill_name);
  if (!skill) return res.status(404).json({ error: 'Навык не найден' });

  const baseModifier = (cs || []).find(e => e.skill_id === skill.id)?.modifier || 0;
  const pIds = (cp || []).map(x => x.perk_id);

  // Бонус от перков
  let perkBonus = 0;
  if (pIds.length) {
    const { data: perks } = await supabase.from('perks').select('*').in('id', pIds);
    for (const p of (perks || [])) {
      for (const m of (p.effect_modifiers || [])) {
        if (m.skill === skill_name) perkBonus += m.modifier || 0;
      }
    }
  }

  // Бонус от родительских навыков через skill_links
  let linkBonus = 0;
  const { data: childLinks } = await supabase.from('skill_links')
    .select('*, parent:skills(*)').eq('child_skill_id', skill.id);
  for (const link of (childLinks || [])) {
    const parentMod = (cs || []).find(e => e.skill_id === link.parent_skill_id)?.modifier || 0;
    linkBonus += Math.round(parentMod * (link.coefficient || 1.0));
  }

  const totalPercent = baseModifier + perkBonus + linkBonus;
  const shots = shots_count || 1;
  const rolls = [];

  for (let i = 0; i < shots; i++) {
    const d20 = Math.floor(Math.random() * 20) + 1;
    const bonus = Math.round(20 * totalPercent / 100);
    const sum = d20 + bonus;
    rolls.push({ d20, bonus, sum });
  }

  res.json({
    character_id, skill_name,
    baseModifier, perkBonus, linkBonus, totalPercent,
    shots,
    rolls,
    formula: shots > 1
      ? rolls.map((r, i) => `Выстрел ${i + 1}: d20(${r.d20}) + ${r.bonus} = ${r.sum}`).join(' | ')
      : `d20(${rolls[0].d20}) + ${rolls[0].bonus} (${totalPercent}%) = ${rolls[0].sum}`
  });
});

export default router;

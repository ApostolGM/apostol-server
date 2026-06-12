// server/server/routes/characterSkills.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/:id/skills', authMiddleware, async (req, res) => {
  const { skill_id, modifier } = req.body;
  const { data, error } = await supabase
    .from('character_skills')
    .insert({
      character_id: req.params.id,
      skill_id,
      modifier: modifier || 0,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/:id/skills/:skillId', authMiddleware, async (req, res) => {
  const { modifier } = req.body;
  const { data, error } = await supabase
    .from('character_skills')
    .update({ modifier })
    .eq('character_id', req.params.id)
    .eq('skill_id', req.params.skillId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id/skills/:skillId', authMiddleware, async (req, res) => {
  await supabase
    .from('character_skills')
    .delete()
    .eq('character_id', req.params.id)
    .eq('skill_id', req.params.skillId);
  res.json({ success: true });
});

export default router;

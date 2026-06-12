// server/server/routes/npc.js
import { Router } from 'express';
import { supabase } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  const { campaign_id, is_template } = req.query;
  let q = supabase.from('npcs').select('*');
  if (campaign_id) q = q.eq('campaign_id', campaign_id);
  if (is_template) q = q.eq('is_template', true);
  const { data } = await q;
  res.json(data || []);
});

router.post('/', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('npcs')
    .insert(req.body)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/:id', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('npcs')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', authMiddleware, async (req, res) => {
  await supabase.from('npcs').delete().eq('id', req.params.id);
  res.json({ success: true });
});

router.post('/:id/clone', authMiddleware, async (req, res) => {
  const { data: orig } = await supabase
    .from('npcs')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (!orig) return res.status(404).json({ error: 'NPC не найден' });

  const { data: clone, error } = await supabase
    .from('npcs')
    .insert({
      name: req.body.name || `${orig.name} (копия)`,
      type: orig.type,
      health_thresholds: orig.health_thresholds,
      skills: orig.skills,
      special_properties: orig.special_properties,
      visibility: orig.visibility,
      campaign_id: orig.campaign_id,
      is_template: false,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(clone);
});

router.post('/:id/roll', authMiddleware, validate(schemas.npcRoll), async (req, res) => {
  const { data: npc } = await supabase
    .from('npcs')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (!npc) return res.status(404).json({ error: 'NPC не найден' });

  const skill = (npc.skills || []).find(s => s.name === req.body.skill_name);
  if (!skill) return res.status(404).json({ error: 'Навык не найден у NPC' });

  const mod = skill.modifier || 0;
  const d20 = Math.floor(Math.random() * 20) + 1;
  res.json({
    npc_name: npc.name,
    skill_name: req.body.skill_name,
    d20roll: d20,
    modifier: mod,
    sum: d20 + mod,
    formula: `d20 (${d20}) + ${mod}`,
  });
});

export default router;

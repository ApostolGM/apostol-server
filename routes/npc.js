// routes/npc.js
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authMiddleware, validate, schemas } from '../middleware.js';
import { notifyCampaign } from '../socket.js';

const router = Router();

// GET /api/npcs
router.get('/', authMiddleware, async (req, res) => {
  const { campaign_id, is_template } = req.query;
  let q = supabase.from('npcs').select('*');
  if (campaign_id) q = q.eq('campaign_id', campaign_id);
  if (is_template) q = q.eq('is_template', true);
  const { data } = await q;
  res.json(data || []);
});

// POST /api/npcs
router.post('/', authMiddleware, async (req, res) => {
  const { data, error } = await supabase.from('npcs').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (data?.campaign_id) notifyCampaign(data.campaign_id, 'npcs_updated', { campaign_id: data.campaign_id });
  res.json(data);
});

// PUT /api/npcs/:id
router.put('/:id', authMiddleware, async (req, res) => {
  const { data: existing } = await supabase.from('npcs').select('campaign_id').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('npcs').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const cid = data?.campaign_id || existing?.campaign_id;
  if (cid) notifyCampaign(cid, 'npcs_updated', { campaign_id: cid });
  res.json(data);
});

// DELETE /api/npcs/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  const { data: existing } = await supabase.from('npcs').select('campaign_id').eq('id', req.params.id).single();
  await supabase.from('npcs').delete().eq('id', req.params.id);
  if (existing?.campaign_id) notifyCampaign(existing.campaign_id, 'npcs_updated', { campaign_id: existing.campaign_id });
  res.json({ success: true });
});

// POST /api/npcs/:id/clone
router.post('/:id/clone', authMiddleware, async (req, res) => {
  const { data: orig } = await supabase.from('npcs').select('*').eq('id', req.params.id).single();
  if (!orig) return res.status(404).json({ error: 'Не найден' });
  const { data: clone, error } = await supabase.from('npcs').insert({
    name: req.body.name || `${orig.name} (копия)`,
    type: orig.type,
    health_thresholds: orig.health_thresholds,
    skills: orig.skills,
    special_properties: orig.special_properties,
    visibility: orig.visibility,
    campaign_id: orig.campaign_id,
    is_template: false
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (clone?.campaign_id) notifyCampaign(clone.campaign_id, 'npcs_updated', { campaign_id: clone.campaign_id });
  res.json(clone);
});

// POST /api/npcs/:id/roll
router.post('/:id/roll', authMiddleware, validate(schemas.npcRoll), async (req, res) => {
  const { data: npc } = await supabase.from('npcs').select('*').eq('id', req.params.id).single();
  if (!npc) return res.status(404).json({ error: 'Не найден' });
  const skill = (npc.skills || []).find(s => s.name === req.body.skill_name);
  if (!skill) return res.status(404).json({ error: 'Навык не найден' });
  const mod = skill.modifier || 0;
  const d20 = Math.floor(Math.random() * 20) + 1;
  res.json({
    npc_name: npc.name, skill_name: req.body.skill_name,
    d20roll: d20, modifier: mod, sum: d20 + mod,
    formula: `d20 (${d20}) + ${mod}`
  });
});

export default router;

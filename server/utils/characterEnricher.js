// server/server/utils/characterEnricher.js
import { supabase } from '../index.js';

export async function enrichCharacter(char) {
  if (!char) return null;

  const enrichSingle = async (ch) => {
    const [
      { data: prof },
      { data: cp },
      { data: cs },
      { data: inv }
    ] = await Promise.all([
      supabase.from('professions').select('*').eq('id', ch.profession_id).single(),
      supabase.from('character_perks').select('perk_id').eq('character_id', ch.id),
      supabase.from('character_skills').select('skill_id, modifier').eq('character_id', ch.id),
      supabase.from('inventory_slots').select('*, item:items(*)').eq('character_id', ch.id),
    ]);

    const pIds = (cp || []).map(x => x.perk_id);
    const sIds = (cs || []).map(x => x.skill_id);

    const [{ data: perks }, { data: skills }] = await Promise.all([
      pIds.length ? supabase.from('perks').select('*').in('id', pIds) : Promise.resolve({ data: [] }),
      sIds.length ? supabase.from('skills').select('*').in('id', sIds) : Promise.resolve({ data: [] }),
    ]);

    const skillMap = {};
    for (const p of (perks || [])) {
      for (const m of (p.effect_modifiers || [])) {
        skillMap[m.skill] = (skillMap[m.skill] || 0) + (m.modifier || 0);
      }
    }

    const enrichedSkills = (skills || []).map(s => {
      const baseMod = (cs || []).find(e => e.skill_id === s.id)?.modifier || 0;
      const perkBonus = skillMap[s.name] || 0;
      return {
        ...s,
        modifier: baseMod,
        baseModifier: baseMod,
        perkBonus,
        totalModifier: baseMod + perkBonus,
        totalPercent: baseMod + perkBonus,
      };
    });

    return {
      ...ch,
      profession: prof || null,
      perks: perks || [],
      skills: enrichedSkills,
      inventory: inv || [],
    };
  };

  if (Array.isArray(char)) {
    return Promise.all(char.map(enrichSingle));
  }
  return enrichSingle(char);
}
